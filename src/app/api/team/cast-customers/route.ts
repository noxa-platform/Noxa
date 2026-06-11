// 事業お店のオーナー/マネージャーが、特定キャストの顧客台帳を俯瞰する。
//
// モデルA: キャストの顧客は personal_customers/{castUid}/items。Admin SDK で読む
// （rules 迂回のため、呼び出し元が shop の owner/manager かつ castUid がその shop の
//  メンバーであることをサーバ側で必ず検証する）。
//
// POST { shopId, castUid } -> { customers: [{ id, name, colorTag, rank, lastContactAt(ISO), totalSales }] }

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    const castUid: string | undefined = body?.castUid;
    if (!shopId || !castUid) {
      return NextResponse.json({ error: 'shopId と castUid は必須です' }, { status: 400 });
    }

    const db = getAdminDb();

    // 権限: 呼び出し元が shop の owner/manager
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
      return NextResponse.json({ error: '閲覧権限がありません（owner/manager のみ）' }, { status: 403 });
    }

    // castUid が当該 shop のメンバーであること
    const castMember = await db.doc(`shop_shops/${shopId}/members/${castUid}`).get();
    if (!castMember.exists && ownerUid !== castUid) {
      return NextResponse.json({ error: 'このキャストはお店のメンバーではありません' }, { status: 403 });
    }

    const custSnap = await db.collection(`personal_customers/${castUid}/items`).get();
    const customers = custSnap.docs.map((c) => {
      const d = c.data() as {
        name?: string; colorTag?: string; rank?: string;
        lastContactAt?: Timestamp; totalSales?: number;
      };
      return {
        id: c.id,
        name: d.name || '—',
        colorTag: d.colorTag ?? null,
        rank: d.rank ?? null,
        lastContactAt: d.lastContactAt instanceof Timestamp ? d.lastContactAt.toDate().toISOString() : null,
        totalSales: d.totalSales || 0,
      };
    });
    customers.sort((a, b) => b.totalSales - a.totalSales);

    return NextResponse.json({ customers });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/team/cast-customers] error:', e);
    return NextResponse.json({ error: '顧客台帳の取得に失敗しました' }, { status: 500 });
  }
}
