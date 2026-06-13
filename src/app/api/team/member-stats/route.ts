// 事業お店のキャスト(メンバー)別・当月成績を返す。
//
// モデルA: 各キャストは自分の顧客台帳 personal_customers/{castUid} を持つ。
// オーナー/マネージャーが全キャストを俯瞰するため、Admin SDK で各キャストの
// personal データを読んで集計する（Firestore rules を迂回するので、呼び出し元が
// 当該 shop の owner/manager であることをサーバ側で必ず検証する）。
//
// POST { shopId, year?, month? }  -> { members: [{ uid, name, role, customerCount, monthSales, monthGroupCount }] }

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

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
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    if (!shopId || typeof shopId !== 'string') {
      return NextResponse.json({ error: 'shopId は必須です' }, { status: 400 });
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

    // 対象月
    const now = new Date();
    const year = Number.isFinite(body?.year) ? Number(body.year) : now.getFullYear();
    const month = Number.isFinite(body?.month) ? Number(body.month) : now.getMonth() + 1; // 1-12
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
        return null;
      });
    for (const l of logsSnap?.docs ?? []) {
      const segs = l.ref.path.split('/');
      // personal_customers/{castUid}/items/{cid}/logs/{lid} 以外（他モデルの logs）は除外
      if (segs[0] !== 'personal_customers') continue;
      const castUid = segs[1];
      if (!targets.has(castUid)) continue;
      const d = l.data() as { salesAmount?: number; countAsGroup?: boolean; type?: string; datetime?: Timestamp };
      const cur = logsAgg.get(castUid) ?? { s: 0, g: 0 };
      const amount = d.salesAmount || 0;
      cur.s += amount;
      const counted = typeof d.countAsGroup === 'boolean' ? d.countAsGroup : d.type === 'visit';
      if (counted) cur.g += 1;
      logsAgg.set(castUid, cur);
      // 日次内訳にも反映（count は countAsGroup 準拠）
      addDaily(jstDateKey(d.datetime), amount, counted ? 1 : 0);
    }

    const members = await Promise.all([...targets.entries()].map(async ([castUid, info]) => {
      // 表示名: members の castDisplayName → account_users.displayName → uid 先頭
      let name = info.name;
      if (!name) {
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }

      // 顧客数は count() 集計（全 doc 読み込みを避ける）
      let customerCount = 0;
      try {
        const cnt = await db.collection(`personal_customers/${castUid}/items`).count().get();
        customerCount = cnt.data().count;
      } catch {
        // 集計失敗時は 0（致命的でない）
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
        .catch(() => null);
      for (const s of ssSnap?.docs ?? []) {
        const d = s.data() as { salesAmount?: number; groupCount?: number; datetime?: Timestamp };
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

    return NextResponse.json({ members, dailyTotals });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/team/member-stats] error:', e);
    return NextResponse.json({ error: 'キャスト成績の取得に失敗しました' }, { status: 500 });
  }
}
