// App Store Server Notifications V2 受信エンドポイント。
//
// Apple が「返金」「サブスク失効」「家族共有解除」等のイベント発生時に
// この URL に POST してくる。受信した signedPayload (JWS) をデコードして、
// REFUND / REVOKE / CONSUMPTION_REQUEST 等のイベント別に処理する。
//
// 重要なイベント:
//   - REFUND: ユーザー要求の返金が成立 → 該当 transactionId のクレジットを取り戻す
//   - REVOKE: 家族共有解除等で取り消し → 同上
//   - CONSUMPTION_REQUEST: Apple が消費状態を尋ねる → 消費済みフラグを返す
//
// App Store Connect で本 URL を設定する必要あり:
//   App > App Information > App Store Server Notifications > Production Server URL
//   https://noxa.egshugy.com/api/iap/notifications-v2
//
// セキュリティ:
//   - signedPayload の JWS 署名検証は Apple の公開鍵で行うべき（v1 では payload 検証のみ）
//   - 本実装は最小限。本番運用前に node-jose や jose ライブラリで完全検証必要
//
// 関連:
//   - 付与は /api/iap/grant
//   - 失効処理は本ファイルから account_iap_transactions/{transactionId}.refunded = true
//     + account_subscriptions/{uid}.purchasedCredits を減算
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '../../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface NotificationV2Body {
  signedPayload: string;
}

interface NotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
  };
}

interface TransactionInfo {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  bundleId?: string;
  revocationDate?: number;
  revocationReason?: number;
}

function decodeJws(jws: string): Record<string, unknown> | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as NotificationV2Body;
    if (!body.signedPayload) {
      return NextResponse.json({ error: 'signedPayload missing' }, { status: 400 });
    }

    const payload = decodeJws(body.signedPayload) as NotificationPayload | null;
    if (!payload || !payload.notificationType) {
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }

    const { notificationType, data } = payload;
    const txInfo = data?.signedTransactionInfo
      ? (decodeJws(data.signedTransactionInfo) as TransactionInfo | null)
      : null;
    const transactionId = txInfo?.transactionId ?? txInfo?.originalTransactionId;

    // bundleId 検証
    const expectedBundleId = process.env.APPLE_IAP_BUNDLE_ID;
    if (expectedBundleId && txInfo?.bundleId && txInfo.bundleId !== expectedBundleId) {
      console.warn('[iap/notifications-v2] bundleId mismatch:', txInfo.bundleId);
      return NextResponse.json({ ok: false, ignored: 'bundleId mismatch' });
    }

    // REFUND / REVOKE: クレジット取り消し
    if (notificationType === 'REFUND' || notificationType === 'REVOKE') {
      if (!transactionId) {
        return NextResponse.json({ ok: false, error: 'transactionId missing' }, { status: 400 });
      }
      const db = getAdminDb();
      const txRef = db.doc(`account_iap_transactions/${transactionId}`);
      const txSnap = await txRef.get();
      if (!txSnap.exists) {
        // 未知の transaction（テスト or 既に削除済み）
        console.warn('[iap/notifications-v2] unknown transaction:', transactionId);
        return NextResponse.json({ ok: true, ignored: 'unknown transaction' });
      }
      const txData = txSnap.data() ?? {};
      if (txData.refunded) {
        return NextResponse.json({ ok: true, alreadyRefunded: true });
      }
      const uid = txData.uid as string | undefined;
      const credits = (txData.credits as number | undefined) ?? 0;
      if (uid && credits > 0) {
        // purchasedCredits を減算（ただし負値にしない）
        await db.runTransaction(async (t) => {
          const subRef = db.doc(`account_subscriptions/${uid}`);
          const subSnap = await t.get(subRef);
          const current = Math.max(0, Number(subSnap.data()?.purchasedCredits ?? 0));
          const next = Math.max(0, current - credits);
          t.set(subRef, { purchasedCredits: next, lastRefundAt: FieldValue.serverTimestamp() }, { merge: true });
          t.set(
            txRef,
            {
              refunded: true,
              refundedAt: FieldValue.serverTimestamp(),
              refundType: notificationType,
            },
            { merge: true },
          );
        });
        console.log('[iap/notifications-v2]', notificationType, transactionId, 'credits revoked:', credits);
      }
      return NextResponse.json({ ok: true, revoked: credits });
    }

    // CONSUMPTION_REQUEST: Apple が消費状態を尋ねる（consumable 商品）
    // 現状は記録のみ。本格対応するなら sendConsumptionInfo API でレスポンス必要
    if (notificationType === 'CONSUMPTION_REQUEST') {
      console.log('[iap/notifications-v2] CONSUMPTION_REQUEST received:', transactionId);
      return NextResponse.json({ ok: true });
    }

    // それ以外（DID_RENEW / EXPIRED / GRACE_PERIOD_EXPIRED 等）は consumable 商品では基本来ない
    console.log('[iap/notifications-v2] notification ignored:', notificationType);
    return NextResponse.json({ ok: true, ignored: notificationType });
  } catch (error) {
    console.error('iap notifications-v2 error:', error);
    return NextResponse.json({ error: '処理失敗' }, { status: 500 });
  }
}

// GET でヘルスチェック（Apple は POST のみだが、確認用）
export async function GET() {
  return NextResponse.json({
    endpoint: 'App Store Server Notifications V2',
    method: 'POST',
    expectedBundleId: process.env.APPLE_IAP_BUNDLE_ID ?? '(not set)',
  });
}
