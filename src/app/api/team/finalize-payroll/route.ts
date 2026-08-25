// 月次給与の確定（owner/manager 専用）。
//   勤務(shifts)×時給(seating_casts.hourlyWage)で各キャストの基本給を算出し、
//   任意の調整（バック/ボーナス/控除）を加えて payrolls/{castUid}/items/{YYYY-MM} に書き込む。
//   period id を YYYY-MM 固定にして set(merge)＝再確定で上書き（重複しない・冪等）。
//   dryRun:true なら書き込まずに計算結果のみ返す（確定前プレビュー用）。
//
// POST { shopId, year, month, dryRun?, adjustments?, wageOverrides? } -> { period, rows:[{castUid,name,hours,wage,base,total}] }
//   adjustments: { [castUid]: { back?:number, bonus?:number, penalty?:number } }（penalty は控除＝正の値で渡す）
//   wageOverrides: { [castUid]: number } … seating_casts 未紐付け（時給0）キャストへ UI から直接時給を渡す
//                  フォールバック。>0 のときのみ名簿の時給より優先。

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { isSafeDocId } from '../../lib/doc-id';
import { pickPeriodPart } from '../../lib/period';
import { toMillis } from '@/lib/datetime';

export const maxDuration = 60;

/**
 * 対象月の受け取り（Day102）。
 *
 * 旧実装は `Number.isFinite(body?.year)` で**型まで厳格に見たうえで、外れたら黙って
 * サーバの当月にフォールバック**していた。つまり不正入力が 400 にならず、
 * 「頼んだ月とは違う月の給与が確定される」形で通ってしまう:
 *   - `{ year: '2026', month: '3' }`（文字列。型ゆるいクライアント）→ isFinite が false ＝
 *     3月ではなく**サーバの当月**が確定される。給与は再確定＝上書きなので、
 *     過去月を締めたつもりで当月を書き潰す事故になる。
 *   - UI で月入力を空にすると `year:NaN`(JSON 上 null) が飛び、同じく当月が確定される。
 *   - `month:13` / `month:1.5` のような範囲外もそのまま period 文字列になる
 *     （実データが引っかからないので書き込みまでは至らないが、契約として弾くべき）。
 * 値が来ていれば数値化して範囲を検証し、不正なら 400。
 * 未指定（undefined）時のサーバ既定月フォールバックだけは既存互換のため温存する。
 * 実体は Day103 で `../../lib/period` へ共通化（team/member-stats が同じ形だったため）。
 */

const numOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    if (!shopId || typeof shopId !== 'string') return NextResponse.json({ error: 'shopId は必須です' }, { status: 400 });
    // shopId は以降すべてのパスの土台になる（Admin SDK＝rules を通らない）。`/` 入りだと
    // 権限確認と書き込みの向き先がまとめてズレる or db.doc() が throw して 500 になる。
    if (!isSafeDocId(shopId)) return NextResponse.json({ error: 'shopId が不正です' }, { status: 400 });

    const db = getAdminDb();

    // 権限: owner/manager
    const shopSnap = await db.doc(`shop_shops/${shopId}`).get();
    if (!shopSnap.exists) return NextResponse.json({ error: 'お店が見つかりません' }, { status: 404 });
    const ownerUid = (shopSnap.data() as { ownerUid?: string } | undefined)?.ownerUid;
    let allowed = ownerUid === uid;
    if (!allowed) {
      const me = await db.doc(`shop_shops/${shopId}/members/${uid}`).get();
      const role = me.exists ? (me.data() as { role?: string }).role : undefined;
      allowed = role === 'owner' || role === 'manager';
    }
    if (!allowed) return NextResponse.json({ error: '給与を確定する権限がありません（owner/manager のみ）' }, { status: 403 });

    const now = new Date();
    const year = pickPeriodPart(body?.year, 2000, 2100, now.getFullYear());
    const month = pickPeriodPart(body?.month, 1, 12, now.getMonth() + 1);
    if (year === null || month === null) return NextResponse.json({ error: '対象年月が不正です（year: 2000〜2100 / month: 1〜12）' }, { status: 400 });
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const dryRun = body?.dryRun === true;
    const adjustments: Record<string, { back?: number; bonus?: number; penalty?: number }> = body?.adjustments && typeof body.adjustments === 'object' ? body.adjustments : {};
    const wageOverrides: Record<string, number> = body?.wageOverrides && typeof body.wageOverrides === 'object' ? body.wageOverrides : {};

    // キャスト名簿（uid → 時給/表示名）
    const castSnap = await db.collection(`shop_shops/${shopId}/seating_casts`).get();
    const castByUid = new Map<string, { name: string; wage: number }>();
    for (const c of castSnap.docs) {
      const x = c.data() as { uid?: string; name?: string; hourlyWage?: number };
      if (x.uid) castByUid.set(x.uid, { name: x.name ?? '', wage: numOr0(x.hourlyWage) });
    }

    // 当月の勤務を castUid 別に集計。
    // 期間クエリ化（Day14 バグハント）: 旧実装は shifts 全件取得＋メモリ側フィルタで、
    // 蓄積すると毎回の確定/プレビューの read 数が破綻する（単一フィールド index で足りる）
    const nextPeriod = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    const shiftsSnap = await db.collection(`shop_shops/${shopId}/shifts`)
      .where('date', '>=', `${period}-01`)
      .where('date', '<', `${nextPeriod}-01`)
      .get();
    const minutesByUid = new Map<string, number>();
    const staleOpensByUid = new Map<string, number>(); // 退勤忘れ（未計上時間）の件数
    // 誰の勤務か判らず給与に載せられなかった行数。**0 でない時点で異常**（P154-PM2）
    let unattributed = 0;
    for (const s of shiftsSnap.docs) {
      const x = s.data() as { castUid?: string; date?: string; startAt?: unknown; endAt?: unknown };
      // ⚠️ ここは以前、**3 つの別の理由を 1 つの guard に畳んでいた**（P154-PM2）。
      // 「別の月だった」は正しい絞り込みだが、「誰の勤務か判らない」は**欠陥**で、
      // 正しい絞り込みに紛れると**その人の勤務時間が給与から消えたまま誰にも見えない**。
      // 捨てる前に理由を分ける（yorulog の原則: 「数えていない」の一段手前に「区別していない」がある）。
      if (!(x.date ?? '').startsWith(period)) continue; // 正しい絞り込み（期間クエリの二重確認）
      if (!x.castUid || !isSafeDocId(x.castUid)) {
        // castUid は payrolls/{castUid}/items/{period} の doc パスに入る。`/` 入りの壊れた値が
        // 1件でも混じると db.doc() が throw して**給与確定が丸ごと 500**になるため、行ごと除外する。
        // ただし**黙って捨てない**——誰にも紐付かない以上、明細の行にも出せず件数でしか伝えられない。
        unattributed += 1;
        continue;
      }
      const st = toMillis(x.startAt), en = toMillis(x.endAt);
      if (st && en && en > st) minutesByUid.set(x.castUid, (minutesByUid.get(x.castUid) ?? 0) + (en - st) / 60000);
      // 退勤打刻が無い(未退勤) or end<=start(日跨ぎを同暦日で締めた旧データ等)の勤務は
      // 0 分＝黙って落とすと過少支給事故になるため、要修正として件数で警告する。
      else if (st && (!en || en <= st)) {
        staleOpensByUid.set(x.castUid, (staleOpensByUid.get(x.castUid) ?? 0) + 1);
        if (!minutesByUid.has(x.castUid)) minutesByUid.set(x.castUid, 0); // 完了勤務ゼロでも行に出す
      }
    }

    const rows: { castUid: string; name: string; hours: number; wage: number; base: number; total: number; staleOpens: number }[] = [];
    const batch = db.batch();
    for (const [castUid, mins] of minutesByUid) {
      const staleOpens = staleOpensByUid.get(castUid) ?? 0;
      if (mins <= 0 && staleOpens === 0) continue;
      const info = castByUid.get(castUid) ?? { name: '', wage: 0 };
      let name = info.name;
      if (!name) {
        // 名簿に無い場合は members の源氏名 → アカウント表示名の順でフォールバック
        const mem = await db.doc(`shop_shops/${shopId}/members/${castUid}`).get().catch(() => null);
        name = (mem?.data() as { castDisplayName?: string } | undefined)?.castDisplayName || '';
      }
      if (!name) {
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }
      // 時給: UI からの直接指定（>0）が名簿より優先（未紐付け=時給0 のフォールバック）
      const override = numOr0(wageOverrides[castUid]);
      const wage = override > 0 ? override : info.wage;
      // 勤務時間は「明細に載る値」と「基本給の計算に使う値」を同一の丸め済み時間に揃える（Day102）。
      // 旧実装は base をフル精度の時間で計算しつつ、明細ラベルは 0.1h 丸め・レスポンスの hours は
      // 0.01h 丸めで返していたため、①明細の「◯h × 時給」を検算すると合わない ②UI が
      // 時給直接入力時に base を hours(0.01h丸め)から再計算する＝**プレビュー表示額と確定額が数円ズレる**。
      const hours = Number((mins / 60).toFixed(2));
      const base = Math.round(hours * wage);
      const adj = adjustments[castUid] ?? {};
      const back = numOr0(adj.back), bonus = numOr0(adj.bonus), penalty = numOr0(adj.penalty);
      const breakdown: { label: string; amount: number }[] = [
        { label: `基本給（勤務 ${hours}h × 時給 ¥${wage.toLocaleString('ja-JP')}）`, amount: base },
      ];
      if (back) breakdown.push({ label: 'バック', amount: back });
      if (bonus) breakdown.push({ label: 'ボーナス', amount: bonus });
      if (penalty) breakdown.push({ label: '控除', amount: -Math.abs(penalty) });
      const total = base + back + bonus - Math.abs(penalty);
      rows.push({ castUid, name, hours, wage, base, total, staleOpens });

      if (!dryRun) {
        batch.set(db.doc(`shop_shops/${shopId}/payrolls/${castUid}/items/${period}`), {
          period,
          label: `${year}年${month}月`,
          total,
          breakdown,
          hours,
          wage,
          status: '確定',
          finalizedAt: FieldValue.serverTimestamp(),
          finalizedBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    if (!dryRun) await batch.commit();
    rows.sort((a, b) => b.total - a.total);
    if (unattributed > 0) {
      console.warn(
        '[api/team/finalize-payroll] 誰の勤務か判らず給与に載せられなかった行があります',
        `shopId=${shopId} period=${period} unattributed=${unattributed}`,
      );
    }
    // ⚠️ 落とした件数を必ず載せる。0 でも省略しない（欄が無いのと 0 件は別のこと）
    return NextResponse.json({ period, dryRun, rows, unattributed });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error('[api/team/finalize-payroll] error:', e);
    return NextResponse.json({ error: '給与確定に失敗しました' }, { status: 500 });
  }
}
