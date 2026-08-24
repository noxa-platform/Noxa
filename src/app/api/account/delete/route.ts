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
    // profile_pages/{handle}（退会後も公開ページが残るのを防ぐ・privacy・F1）
    // account_users 削除より前に handle を読む（順序を入れ替えないこと）。
    const userSnap = await db.doc(`account_users/${uid}`).get();
    const handle = userSnap.exists ? userSnap.data()?.handle : undefined;
    if (handle) {
      await db.doc(`profile_pages/${handle}`).delete();
    }

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

    // personal_* の個人データツリー（Day82・yorulog からの指摘で是正）。
    // これまで消していたのは account_* と personal_reminders の「ownerUid 付きフラット doc」
    // だけで、実際の正本である `personal_<name>/{uid}/items/...` は**丸ごと残っていた**。
    // ＝ 退会後も顧客台帳・売上・AI スレッドが残る状態だった。
    // パスは uid 単位に閉じているので、本人の doc を根から再帰削除すれば他人には触れない。
    // サブコレクション（items / standalone / スレッドの messages）まで消すため
    // recursiveDelete を使う（doc.delete() はサブコレクションを残す）。
    const PERSONAL_ROOTS = [
      'personal_customers',
      'personal_sales',          // items / standalone の 2 系統
      'personal_templates',
      'personal_ai_threads',     // items/{tid}/messages まで
      'personal_goals',
      'personal_reminders',
      'personal_business_cards',
      'personal_self_styles',    // uid 直下の単一 doc（サブコレクション無し）
    ];
    for (const root of PERSONAL_ROOTS) {
      await db.recursiveDelete(db.doc(`${root}/${uid}`));
    }

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
