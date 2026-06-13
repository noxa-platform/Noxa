// 事業お店の「その他（未担当）」顧客（shop_shops/{shopId}/customers）を、特定キャストの
// 担当台帳（personal_customers/{castUid}/items）へ割り当て（移動）する。
//
// モデルA: 担当付き客の正本は各キャストの personal_customers/{castUid}/items。
// 未担当客は shop_shops/{shopId}/customers に置かれており、owner/manager が担当を
// 割り当てると、その doc と配下サブコレクション（logs / gifts）を担当台帳へ移し、
// 元の未担当 doc を削除する。
//
// 安全設計（本番データの移動＝不可逆のため）:
//   - 先に「コピー」を完了させ、成功後に「削除」する（途中で失敗しても二重に
//     存在するだけでデータ消失しない＝復旧可能）。
//   - Admin SDK は rules を迂回するため、呼び出し元が当該 shop の owner/manager で
//     あること、castUid がその shop の cast 系メンバーであることをサーバ側で検証する。
//   - サブコレクションは Firestore バッチ上限(500)を避けて 400 件ずつ分割。
//
// POST { shopId, customerId, castUid } -> { ok: true }

import { NextRequest, NextResponse } from 'next/server';
import type { Firestore, CollectionReference } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';

// 顧客＋ログ移動は読み書き回数が多いので関数タイムアウトを延長。
export const maxDuration = 60;

const BATCH_LIMIT = 400; // Firestore バッチ上限 500 の安全側

// 移動対象のサブコレクション（存在するものだけ処理）
const SUB_COLLECTIONS = ['logs', 'gifts'] as const;

// src コレクションの全 doc を dest コレクションへ doc ID を保ったままコピー（分割書込）。
async function copyCollection(db: Firestore, src: CollectionReference, dest: CollectionReference): Promise<void> {
  const snap = await src.get();
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) {
      batch.set(dest.doc(d.id), d.data());
    }
    await batch.commit();
  }
}

// コレクションの全 doc を分割削除。
async function deleteCollection(db: Firestore, col: CollectionReference): Promise<void> {
  const snap = await col.get();
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const shopId: string | undefined = body?.shopId;
    const customerId: string | undefined = body?.customerId;
    const castUid: string | undefined = body?.castUid;
    if (!shopId || !customerId || !castUid || typeof shopId !== 'string' || typeof customerId !== 'string' || typeof castUid !== 'string') {
      return NextResponse.json({ error: 'shopId / customerId / castUid は必須です' }, { status: 400 });
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
      return NextResponse.json({ error: '担当を割り当てる権限がありません（owner/manager のみ）' }, { status: 403 });
    }

    // castUid が当該 shop の cast 系メンバーであること（owner 本人が接客する運用も許容）
    const CAST_ROLES = new Set(['cast', 'host', 'staff', 'owner', 'manager']);
    const castMember = await db.doc(`shop_shops/${shopId}/members/${castUid}`).get();
    const castRole = castMember.exists ? (castMember.data() as { role?: string }).role : undefined;
    const castIsMember = (castMember.exists && CAST_ROLES.has(castRole || 'cast')) || ownerUid === castUid;
    if (!castIsMember) {
      return NextResponse.json({ error: '割り当て先がお店のメンバーではありません' }, { status: 403 });
    }

    // 移動元の未担当顧客
    const srcRef = db.doc(`shop_shops/${shopId}/customers/${customerId}`);
    const srcSnap = await srcRef.get();
    if (!srcSnap.exists) {
      return NextResponse.json({ error: '対象の顧客が見つかりません（既に割り当て済みの可能性）' }, { status: 404 });
    }

    const destRef = db.doc(`personal_customers/${castUid}/items/${customerId}`);

    // 1) コピー（先に完了させる）。担当紐付けフィールドを付与し、merge で既存を温存。
    const srcData = srcSnap.data() ?? {};
    await destRef.set({
      ...srcData,
      mainCastUid: castUid,
      assignedFromShopId: shopId,
      assignedBy: uid,
      assignedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const sub of SUB_COLLECTIONS) {
      await copyCollection(db, srcRef.collection(sub), destRef.collection(sub));
    }

    // 2) コピー成功後に元を削除（サブコレクション→本体の順）。
    for (const sub of SUB_COLLECTIONS) {
      await deleteCollection(db, srcRef.collection(sub));
    }
    await srcRef.delete();

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    console.error('[api/team/assign-customer] error:', e);
    return NextResponse.json({ error: '担当の割り当てに失敗しました' }, { status: 500 });
  }
}
