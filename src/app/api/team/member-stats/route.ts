// 事業お店のキャスト(メンバー)別・当月成績を返す。
//
// モデルA: 各キャストは自分の顧客台帳 personal_customers/{castUid} を持つ。
// オーナー/マネージャーが全キャストを俯瞰するため、Admin SDK で各キャストの
// personal データを読んで集計する（Firestore rules を迂回するので、呼び出し元が
// 当該 shop の owner/manager であることをサーバ側で必ず検証する）。
//
// POST { shopId, year?, month? }
//   -> { members: [{ uid, name, role, customerCount, monthSales, monthGroupCount }], dailyTotals, period }
//   period は実際に集計した年月（クライアントが「頼んだ月」と突き合わせられるように返す・Day103）
//   scopeNote は集計範囲の説明（当店由来のみ・P128）
//
// 集計範囲（P128）: 個人台帳は「そのキャストの全部」であって「当店の分」ではない。
// 掛け持ちが標準の業界なので、出所（shopId / assignedFromShopId）で当店由来だけに絞る。
// 判定は src/lib/shop-scope.ts に一本化（ここでインライン判定を書き足さないこと）。

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { isSafeDocId } from '../../lib/doc-id';
import { pickPeriodPart } from '../../lib/period';
import { countsAsGroup } from '@/lib/log-metrics';
import { belongsToShop, SHOP_SCOPE_NOTE } from '@/lib/shop-scope';

// キャスト×顧客の集計は読み取り回数が多いので関数タイムアウトを延長。
export const maxDuration = 60;

// JST 暦日キー（YYYY-MM-DD）。サーバは UTC 動作のため +9h してから日付を取る。
// 営業日切替は iOS 側で再フィルタするため、ここでは datetime ベースの暦日で返す。
function jstDateKey(ts: Timestamp | undefined | null): string | null {
  if (!ts || typeof ts.toMillis !== 'function') return null;
  return new Date(ts.toMillis() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    /**
     * 集計の途中で**読めなかった**ものを記録する（Day116）。
     *
     * この route は売上ログ・個人売上・顧客数の取得失敗をすべて null/0 に倒したうえで
     * **200 を返して**いた。クライアントから見ると「今月の売上 0 / 顧客 0」と区別が付かず、
     * 成績画面が静かに全員ゼロになる（給与や評価の判断材料になる数字）。
     * サーバ側は rules を通らない Admin SDK なので、権限エラーではなく
     * インデックス欠落・タイムアウト・一時障害でここに落ちる。
     */
    const incomplete: string[] = [];
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    if (!shopId || typeof shopId !== 'string') {
      return NextResponse.json({ error: 'shopId は必須です' }, { status: 400 });
    }
    // Admin SDK は rules を通らないため、パスの土台になる shopId は `/` 入りを弾く（Day102）
    if (!isSafeDocId(shopId)) {
      return NextResponse.json({ error: 'shopId が不正です' }, { status: 400 });
    }

    const db = getAdminDb();

    // 権限検証: 呼び出し元が shop の owner/manager か（cast 同士で覗けないようにする）
    const shopSnap = await db.doc(`shop_shops/${shopId}`).get();
    if (!shopSnap.exists) {
      return NextResponse.json({ error: 'お店が見つかりません' }, { status: 404 });
    }
    const ownerUid = (shopSnap.data() as { ownerUid?: string } | undefined)?.ownerUid;
    let allowed = ownerUid === uid;
    if (!allowed) {
      const meSnap = await db.doc(`shop_shops/${shopId}/members/${uid}`).get();
      const role = meSnap.exists ? (meSnap.data() as { role?: string }).role : undefined;
      allowed = role === 'owner' || role === 'manager';
    }
    if (!allowed) {
      return NextResponse.json({ error: 'キャスト成績の閲覧権限がありません（owner/manager のみ）' }, { status: 403 });
    }

    // 対象月（Day103: finalize-payroll と同じ契約に揃える）。
    // 旧実装は `Number.isFinite(body?.year)` ＝**型まで厳格に見て、外れたら黙って当月へ**
    // フォールバックしていた。`{year:'2026',month:'3'}`（数値文字列を送るクライアント）だと
    // 3 月を頼んだのに当月の成績が返り、レスポンスにも対象月が入っていないため
    // **画面は「3 月の成績」として当月の数字を表示する**（誰も気づけない）。
    // 給与確定（Day102 の実バグ）と同型なので、同じヘルパーで弾き、対象月も返す。
    const now = new Date();
    const year = pickPeriodPart(body?.year, 2000, 2999, now.getFullYear());
    const month = pickPeriodPart(body?.month, 1, 12, now.getMonth() + 1); // 1-12
    if (year === null || month === null) {
      return NextResponse.json({ error: 'year / month が不正です' }, { status: 400 });
    }
    const monthStart = Timestamp.fromDate(new Date(year, month - 1, 1));
    const monthEnd = Timestamp.fromDate(new Date(year, month, 1));

    // メンバー一覧（cast 系のみ集計。owner / accounting の個人台帳をお店に混ぜない。
    // オーナーが実際に接客するなら cast ロールのメンバーとして登録する運用とする）
    const CAST_ROLES = new Set(['cast', 'host', 'staff']);
    const memSnap = await db.collection(`shop_shops/${shopId}/members`).get();
    const targets = new Map<string, { role: string; name: string }>();
    for (const m of memSnap.docs) {
      const md = m.data() as { role?: string; castDisplayName?: string; castName?: string };
      const role = md.role || 'cast';
      if (!CAST_ROLES.has(role)) continue; // owner / accounting を除外
      targets.set(m.id, { role, name: md.castDisplayName || md.castName || '' });
    }
    // ※ オーナー自動追加は廃止（オーナー個人台帳=個人副業データの混入防止）。

    // 当月の全ログを collectionGroup で 1 回だけ取得し castUid 別に集計する。
    // 旧実装はキャスト×顧客ごとにログをクエリしており（N×M）、店舗規模で
    // 数百〜千クエリに膨れて事業WSの読み込みが重かった。ログの doc パス
    // personal_customers/{castUid}/items/{cid}/logs/{lid} から castUid を取り出す。
    // ※ collectionGroup は全テナントのログを月レンジで舐めるため、将来規模が
    //   大きくなったら logs に castUid フィールドを持たせた per-cast 集計へ移行する。
    const logsAgg = new Map<string, { s: number; g: number }>();
    // 日次内訳（全キャスト合算）。dateKey(JST暦日) -> { amount, count }
    const dailyMap = new Map<string, { amount: number; count: number }>();
    const addDaily = (dateKey: string | null, amount: number, count: number) => {
      if (!dateKey) return;
      const cur = dailyMap.get(dateKey) ?? { amount: 0, count: 0 };
      cur.amount += amount;
      cur.count += count;
      dailyMap.set(dateKey, cur);
    };
    const logsSnap = await db
      .collectionGroup('logs')
      .where('datetime', '>=', monthStart)
      .where('datetime', '<', monthEnd)
      .get()
      .catch((e) => {
        console.error('[api/team/member-stats] collectionGroup(logs) failed:', e);
        incomplete.push('来店ログ');
        return null;
      });
    for (const l of logsSnap?.docs ?? []) {
      const segs = l.ref.path.split('/');
      // personal_customers/{castUid}/items/{cid}/logs/{lid} 以外（他モデルの logs）は除外
      if (segs[0] !== 'personal_customers') continue;
      const castUid = segs[1];
      if (!targets.has(castUid)) continue;
      const d = l.data() as { salesAmount?: number; countAsGroup?: boolean; type?: string; datetime?: Timestamp; shopId?: unknown };
      // 出所が当店だと確認できたログだけ数える（P128）。
      // 旧実装は castUid が当店のメンバーかしか見ておらず、**掛け持ち先の売上**が
      // 当店の月間売上・組数・日次内訳に加算されていた（給与査定の材料）。
      // ログには CF が最初から shopId を刻んでいるので、出所不明＝個人が店を経由せず
      // 付けた記録と判断できる。範囲外なので incomplete（読めなかった）には数えない。
      if (!belongsToShop(d, shopId)) continue;
      const cur = logsAgg.get(castUid) ?? { s: 0, g: 0 };
      const amount = d.salesAmount || 0;
      cur.s += amount;
      // 組数判定は正準ルール（visit || outside）に一本化。旧実装は outside を取りこぼしていた（Day58）
      const counted = countsAsGroup(d.type, d.countAsGroup);
      if (counted) cur.g += 1;
      logsAgg.set(castUid, cur);
      // 日次内訳にも反映（count は countAsGroup 準拠）
      addDaily(jstDateKey(d.datetime), amount, counted ? 1 : 0);
    }

    const members = await Promise.all([...targets.entries()].map(async ([castUid, info]) => {
      // 表示名: members の castDisplayName → account_users.displayName → uid 先頭
      let name = info.name;
      if (!name) {
        // 表示名だけは uid 先頭へ劣化させる（画面に劣化が見えるので incomplete には数えない）
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }

      // 顧客数は count() 集計（全 doc 読み込みを避ける）。
      // 当店から渡った客だけを数える（P128）。旧実装は台帳の全件で、他店の客も
      // 本人が個人で登録した客も「当店の担当顧客数」として出していた。
      // assignedFromShopId は単一フィールドの等価比較なので既定の索引で引ける
      // （複合インデックスの追加は不要）。
      let customerCount = 0;
      try {
        const cnt = await db.collection(`personal_customers/${castUid}/items`)
          .where('assignedFromShopId', '==', shopId)
          .count().get();
        customerCount = cnt.data().count;
      } catch (e) {
        // 0 と「数えられなかった」を混ぜない（画面には「顧客0人」と出てしまう）
        console.error('[api/team/member-stats] customer count failed:', castUid, e);
        incomplete.push('顧客数');
      }

      const base = logsAgg.get(castUid) ?? { s: 0, g: 0 };
      let monthSales = base.s;
      let monthGroupCount = base.g;

      // 顧客なし日売（collectionGroup 名 items は personal_customers/items と衝突するため
      //              従来どおり cast 単位で読む。1 キャスト 1 クエリで軽い）
      const ssSnap = await db.collection(`personal_sales/${castUid}/items`)
        .where('datetime', '>=', monthStart)
        .where('datetime', '<', monthEnd)
        .get()
        .catch((e) => {
          console.error('[api/team/member-stats] personal_sales failed:', castUid, e);
          incomplete.push('個人売上');
          return null;
        });
      for (const s of ssSnap?.docs ?? []) {
        const d = s.data() as { salesAmount?: number; groupCount?: number; datetime?: Timestamp; shopId?: unknown };
        // 出所が当店のものだけ（P128）。個人ワークスペースの手入力売上（SalesClient が
        // shopId 無しで書く＝本人の副業）と他店の控えを店の成績から外す。
        // クエリではなくここで絞るのは、shopId + datetime の複合インデックスを
        // 増やさないため（1 キャスト 1 か月＝件数が小さく、絞り込みの費用が問題にならない）。
        if (!belongsToShop(d, shopId)) continue;
        const amount = d.salesAmount || 0;
        const gc = (d.groupCount && d.groupCount > 0) ? d.groupCount : 1;
        monthSales += amount;
        monthGroupCount += gc;
        // 日次内訳にも反映（JS は単一スレッド協調動作のため共有 Map への同期加算は安全）
        addDaily(jstDateKey(d.datetime), amount, gc);
      }

      return { uid: castUid, name, role: info.role, customerCount, monthSales, monthGroupCount };
    }));

    members.sort((a, b) => b.monthSales - a.monthSales);

    // 日次内訳（全キャスト合算）を dateKey 昇順で返す。
    const dailyTotals = [...dailyMap.entries()]
      .map(([dateKey, v]) => ({ dateKey, amount: v.amount, count: v.count }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // 欠けたまま「0」を成績として見せない。クライアントは incomplete があれば警告を出す。
    // ⚠️ P162: **0 件でも必ず配列で返す**（`record-engine/apply` の `trimmed` と同じ契約）。
    // 以前は `...(len > 0 ? { incomplete } : {})` でキーごと消しており、呼出側からは
    // 「読めなかった項目はゼロ」と「そもそも報告していない」が**同じに見えていた**
    // （`data.incomplete?.length` は前者でも後者でも false になる＝読まなくても通る）。
    const uniqueIncomplete = [...new Set(incomplete)];
    return NextResponse.json({
      members, dailyTotals, period: { year, month }, scopeNote: SHOP_SCOPE_NOTE,
      incomplete: uniqueIncomplete,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/team/member-stats] error:', e);
    return NextResponse.json({ error: 'キャスト成績の取得に失敗しました' }, { status: 500 });
  }
}
