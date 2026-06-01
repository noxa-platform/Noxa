import { NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth, verifyRequest, AuthError } from '../../lib/firebase-admin';

// 退会（アカウント削除）API。
// 2026-05-18: Stripe を廃止し、課金は iOS StoreKit / Android Google Play IAP に統一。
// IAP は consumable のため「退会で解約」する概念が無い（残クレジットは uid 削除と共に消失）。
// 既存ユーザーの crm_subscriptions ドキュメントは履歴として残してきたが、退会時には削除する。

export async function POST(request: Request) {
  try {
    const uid = await verifyRequest(request);
    const db = getAdminDb();

    // 1. Firestore データ削除
    // account_users/{uid}
    await db.doc(`account_users/${uid}`).delete();
    // account_subscriptions/{uid}（IAP 経由の purchasedCredits 残も同時に消える）
    await db.doc(`account_subscriptions/${uid}`).delete();
    // account_google_tokens/{uid}
    await db.doc(`account_google_tokens/${uid}`).delete();
    // notification_push_tokens/{uid}
    await db.doc(`notification_push_tokens/${uid}`).delete();

    // account_ai_usage/{uid}/monthly/* サブコレクション削除
    const aiUsageSnaps = await db.collection(`account_ai_usage/${uid}/monthly`).get();
    const batch1 = db.batch();
    aiUsageSnaps.docs.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();
    await db.doc(`account_ai_usage/${uid}`).delete();

    // personal_reminders（ownerUid == uid のもの）
    const reminderSnaps = await db.collection('personal_reminders')
      .where('ownerUid', '==', uid).get();
    const batch2 = db.batch();
    reminderSnaps.docs.forEach(doc => batch2.delete(doc.ref));
    await batch2.commit();

    // ワークスペースメンバーから自身を削除
    // owner の場合はワークスペース自体を削除（サブコレクションは残るが MVP 段階では許容）
    const allWsSnaps = await db.collection('shop_shops').get();
    const batch3 = db.batch();
    for (const wsDoc of allWsSnaps.docs) {
      const memberSnap = await db.doc(`shop_shops/${wsDoc.id}/members/${uid}`).get();
      if (memberSnap.exists) {
        const wsData = wsDoc.data();
        if (wsData.ownerUid === uid) {
          // オーナーの場合は WS 自体を削除
          batch3.delete(wsDoc.ref);
        }
        batch3.delete(memberSnap.ref);
      }
    }
    await batch3.commit();

    // 2. Firebase Auth ユーザー削除
    await getAdminAuth().deleteUser(uid);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('退会処理エラー:', error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: '退会処理に失敗しました' }, { status: 500 });
  }
}
