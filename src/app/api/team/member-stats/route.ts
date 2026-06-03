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

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json();
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

    // メンバー一覧（owner が members サブコレクションに無い運用でも集計対象に含める）
    const memSnap = await db.collection(`shop_shops/${shopId}/members`).get();
    const targets = new Map<string, { role: string; name: string }>();
    for (const m of memSnap.docs) {
      const md = m.data() as { role?: string; castDisplayName?: string; castName?: string };
      targets.set(m.id, { role: md.role || 'cast', name: md.castDisplayName || md.castName || '' });
    }
    if (ownerUid && !targets.has(ownerUid)) {
      targets.set(ownerUid, { role: 'owner', name: '' });
    }

    const members = await Promise.all([...targets.entries()].map(async ([castUid, info]) => {
      // 表示名: members の castDisplayName → account_users.displayName → uid 先頭
      let name = info.name;
      if (!name) {
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }

      const custSnap = await db.collection(`personal_customers/${castUid}/items`).get().catch(() => null);
      const customerCount = custSnap?.size ?? 0;

      // 顧客ごとの当月ログを並列取得（N+1 の直列待ちでタイムアウトするのを回避）
      const perCustomer = await Promise.all((custSnap?.docs ?? []).map(async (c) => {
        const logsSnap = await db
          .collection(`personal_customers/${castUid}/items/${c.id}/logs`)
          .where('datetime', '>=', monthStart)
          .where('datetime', '<', monthEnd)
          .get()
          .catch(() => null);
        let s = 0, g = 0;
        for (const l of logsSnap?.docs ?? []) {
          const d = l.data() as { salesAmount?: number; countAsGroup?: boolean; type?: string };
          s += d.salesAmount || 0;
          const counted = typeof d.countAsGroup === 'boolean' ? d.countAsGroup : d.type === 'visit';
          if (counted) g += 1;
        }
        return { s, g };
      }));
      let monthSales = perCustomer.reduce((acc, x) => acc + x.s, 0);
      let monthGroupCount = perCustomer.reduce((acc, x) => acc + x.g, 0);

      // 顧客なし日売
      const ssSnap = await db.collection(`personal_sales/${castUid}/items`)
        .where('datetime', '>=', monthStart)
        .where('datetime', '<', monthEnd)
        .get()
        .catch(() => null);
      for (const s of ssSnap?.docs ?? []) {
        const d = s.data() as { salesAmount?: number; groupCount?: number };
        monthSales += d.salesAmount || 0;
        monthGroupCount += (d.groupCount && d.groupCount > 0) ? d.groupCount : 1;
      }

      return { uid: castUid, name, role: info.role, customerCount, monthSales, monthGroupCount };
    }));

    members.sort((a, b) => b.monthSales - a.monthSales);
    return NextResponse.json({ members });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/team/member-stats] error:', e);
    return NextResponse.json({ error: 'キャスト成績の取得に失敗しました' }, { status: 500 });
  }
}
