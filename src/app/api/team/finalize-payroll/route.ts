// 月次給与の確定（owner/manager 専用）。
//   勤務(shifts)×時給(seating_casts.hourlyWage)で各キャストの基本給を算出し、
//   任意の調整（バック/ボーナス/控除）を加えて payrolls/{castUid}/items/{YYYY-MM} に書き込む。
//   period id を YYYY-MM 固定にして set(merge)＝再確定で上書き（重複しない・冪等）。
//   dryRun:true なら書き込まずに計算結果のみ返す（確定前プレビュー用）。
//
// POST { shopId, year, month, dryRun?, adjustments? } -> { period, rows:[{castUid,name,hours,wage,base,total}] }
//   adjustments: { [castUid]: { back?:number, bonus?:number, penalty?:number } }（penalty は控除＝正の値で渡す）

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

export const maxDuration = 60;

function toMs(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  if (typeof v === 'number') return v;
  return 0;
}
const numOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    if (!shopId || typeof shopId !== 'string') return NextResponse.json({ error: 'shopId は必須です' }, { status: 400 });

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
    const year = Number.isFinite(body?.year) ? Number(body.year) : now.getFullYear();
    const month = Number.isFinite(body?.month) ? Number(body.month) : now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const dryRun = body?.dryRun === true;
    const adjustments: Record<string, { back?: number; bonus?: number; penalty?: number }> = body?.adjustments && typeof body.adjustments === 'object' ? body.adjustments : {};

    // キャスト名簿（uid → 時給/表示名）
    const castSnap = await db.collection(`shop_shops/${shopId}/seating_casts`).get();
    const castByUid = new Map<string, { name: string; wage: number }>();
    for (const c of castSnap.docs) {
      const x = c.data() as { uid?: string; name?: string; hourlyWage?: number };
      if (x.uid) castByUid.set(x.uid, { name: x.name ?? '', wage: numOr0(x.hourlyWage) });
    }

    // 当月の勤務を castUid 別に集計
    const shiftsSnap = await db.collection(`shop_shops/${shopId}/shifts`).get();
    const minutesByUid = new Map<string, number>();
    for (const s of shiftsSnap.docs) {
      const x = s.data() as { castUid?: string; date?: string; startAt?: unknown; endAt?: unknown };
      if (!x.castUid || !(x.date ?? '').startsWith(period)) continue;
      const st = toMs(x.startAt), en = toMs(x.endAt);
      if (st && en && en > st) minutesByUid.set(x.castUid, (minutesByUid.get(x.castUid) ?? 0) + (en - st) / 60000);
    }

    const rows: { castUid: string; name: string; hours: number; wage: number; base: number; total: number }[] = [];
    const batch = db.batch();
    for (const [castUid, mins] of minutesByUid) {
      if (mins <= 0) continue;
      const info = castByUid.get(castUid) ?? { name: '', wage: 0 };
      let name = info.name;
      if (!name) {
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }
      const hours = mins / 60;
      const base = Math.round(hours * info.wage);
      const adj = adjustments[castUid] ?? {};
      const back = numOr0(adj.back), bonus = numOr0(adj.bonus), penalty = numOr0(adj.penalty);
      const breakdown: { label: string; amount: number }[] = [
        { label: `基本給（勤務 ${hours.toFixed(1)}h × 時給 ¥${info.wage.toLocaleString('ja-JP')}）`, amount: base },
      ];
      if (back) breakdown.push({ label: 'バック', amount: back });
      if (bonus) breakdown.push({ label: 'ボーナス', amount: bonus });
      if (penalty) breakdown.push({ label: '控除', amount: -Math.abs(penalty) });
      const total = base + back + bonus - Math.abs(penalty);
      rows.push({ castUid, name, hours: Number(hours.toFixed(2)), wage: info.wage, base, total });

      if (!dryRun) {
        batch.set(db.doc(`shop_shops/${shopId}/payrolls/${castUid}/items/${period}`), {
          period,
          label: `${year}年${month}月`,
          total,
          breakdown,
          hours: Number(hours.toFixed(2)),
          wage: info.wage,
          status: '確定',
          finalizedAt: FieldValue.serverTimestamp(),
          finalizedBy: uid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    if (!dryRun) await batch.commit();
    rows.sort((a, b) => b.total - a.total);
    return NextResponse.json({ period, dryRun, rows });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error('[api/team/finalize-payroll] error:', e);
    return NextResponse.json({ error: '給与確定に失敗しました' }, { status: 500 });
  }
}
