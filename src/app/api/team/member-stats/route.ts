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

    // メンバー一覧
    const memSnap = await db.collection(`shop_shops/${shopId}/members`).get();

    const members = await Promise.all(memSnap.docs.map(async (m) => {
      const castUid = m.id;
      const mdata = m.data() as { role?: string; castDisplayName?: string; castName?: string };
      // 表示名: members の castDisplayName → account_users.displayName → uid 先頭
      let name = mdata.castDisplayName || mdata.castName || '';
      if (!name) {
        const acc = await db.doc(`account_users/${castUid}`).get().catch(() => null);
        name = (acc?.data() as { displayName?: string } | undefined)?.displayName || castUid.slice(0, 8);
      }

      let monthSales = 0;
      let monthGroupCount = 0;

      // 各キャストの個人顧客 → 当月ログ集計
      const custSnap = await db.collection(`personal_customers/${castUid}/items`).get().catch(() => null);
      const customerCount = custSnap?.size ?? 0;
      if (custSnap) {
        for (const c of custSnap.docs) {
          const logsSnap = await db
            .collection(`personal_customers/${castUid}/items/${c.id}/logs`)
            .where('datetime', '>=', monthStart)
            .where('datetime', '<', monthEnd)
            .get()
            .catch(() => null);
          if (!logsSnap) continue;
          for (const l of logsSnap.docs) {
            const d = l.data() as { salesAmount?: number; countAsGroup?: boolean; type?: string };
            monthSales += d.salesAmount || 0;
            const counted = typeof d.countAsGroup === 'boolean' ? d.countAsGroup : d.type === 'visit';
            if (counted) monthGroupCount += 1;
          }
        }
      }

      // 顧客なし日売
      const ssSnap = await db.collection(`personal_sales/${castUid}/items`)
        .where('datetime', '>=', monthStart)
        .where('datetime', '<', monthEnd)
        .get()
        .catch(() => null);
      if (ssSnap) {
        for (const s of ssSnap.docs) {
          const d = s.data() as { salesAmount?: number; groupCount?: number };
          monthSales += d.salesAmount || 0;
          monthGroupCount += (d.groupCount && d.groupCount > 0) ? d.groupCount : 1;
        }
      }

      return {
        uid: castUid,
        name,
        role: mdata.role || 'cast',
        customerCount,
        monthSales,
        monthGroupCount,
      };
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
