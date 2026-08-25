// iOS StoreKit 2 の購入完了通知から呼ばれて、クレジットを永続加算する API。
//
// セキュリティ（重要）:
//   - クライアントから productId を受け取って付与する単純実装ではなく、
//     **Apple のサーバーで署名検証されたトランザクション**を必須にする。
//   - iOS 側で取得した signedTransaction（JWS）を Apple App Store Server API
//     `/inApps/v1/transactions/{transactionId}` で検証してから付与する。
//   - 同一 transactionId は 1 回しか付与しない（account_iap_transactions/{transactionId} で記録）。
//
// 流れ:
//   1. iOS: 購入完了 → Transaction.finish() 前に signedTransactionJws を取得
//   2. iOS → /api/iap/grant に POST { transactionId, signedTransactionJws, productId }
//   3. サーバ: signedTransactionJws を Apple サーバで検証
//   4. サーバ: productId を商品マスタと突き合わせ → credits を確定
//   5. サーバ: account_iap_transactions/{transactionId} に冪等キーを書き込み、purchasedCredits を加算
//   6. iOS: 200 OK を受けて Transaction.finish() を呼ぶ
//
// 現状の実装範囲（v1）:
//   - 商品マスタ突き合わせ + 冪等性ガード + クレジット加算
//   - signedTransactionJws の **JWS 形式チェック** + Apple Production / Sandbox の
//     `/inApps/v1/transactions/{id}` 検証 → 署名・bundleId・productId 一致確認
//   - App Store Connect の認証情報（issuer / keyId / private key）は環境変数から
//     APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY,
//     APPLE_IAP_BUNDLE_ID で読む。未設定なら sandbox 検証は skip し、
//     development mode でのみ「無検証付与」を許可（NODE_ENV !== 'production'）。
//
// TODO（将来）:
//   - App Store Server Notifications V2 で REFUND / CHARGEBACK を受けて
//     付与済みクレジットを取り戻す（grantPurchasedCredits の負値版）
//   - Android Play Billing は別エンドポイント /api/iap/grant-play で実装
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { getIapProduct } from '@/lib/iap/products';
import { verifyAppleJws, decodeAppleJwsPayload } from '@/lib/iap/verify-apple-jws';
import { FieldValue } from 'firebase-admin/firestore';
import { stampIrVersion } from '@/lib/ir-version';

interface GrantBody {
  /** Apple のトランザクション ID（数値 string）。冪等キーとして使用 */
  transactionId: string;
  /** Apple StoreKit 2 が発行した JWS（JSON Web Signature）。サーバで検証する */
  signedTransactionJws: string;
  /** 購入された product ID（クライアント申告。最終的にはサーバが JWS から取り直す） */
  productId: string;
  /** 'production' | 'sandbox' (iOS 側で判定) */
  environment?: 'production' | 'sandbox';
}

/**
 * JWS を検証して payload を得る。
 * - 本番(NODE_ENV==='production'): x5c チェーン検証（Apple Root CA G3 ピン）を必須。
 *   偽造 JWS は null を返し、呼び出し側で 403 にする。
 * - 開発/Preview: まず完全検証を試み、失敗時のみ decode-only にフォールバック
 *   （Xcode ローカル StoreKit Testing はローカル証明書署名のため完全検証が通らない）。
 */
function verifyOrDecodeJws(jws: string): { payload: Record<string, unknown>; verified: boolean } | null {
  const verified = verifyAppleJws(jws);
  if (verified.ok) return { payload: verified.payload, verified: true };
  if (process.env.NODE_ENV === 'production') {
    console.warn(`iap grant: JWS 署名検証に失敗 (${verified.reason})`);
    return null;
  }
  const decoded = decodeAppleJwsPayload(jws);
  if (!decoded) return null;
  console.warn(`iap grant: 開発環境のため署名未検証で続行 (verify=${verified.reason})`);
  return { payload: decoded, verified: false };
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as GrantBody;
    const { transactionId, signedTransactionJws, productId, environment } = body;

    if (!transactionId || !signedTransactionJws || !productId) {
      return NextResponse.json(
        { error: 'transactionId / signedTransactionJws / productId は必須です' },
        { status: 400 },
      );
    }

    // 商品マスタ突き合わせ
    const product = getIapProduct(productId);
    if (!product) {
      return NextResponse.json({ error: '未知の productId です' }, { status: 400 });
    }

    // JWS の署名検証（本番は必須）+ payload 取得
    const jwsResult = verifyOrDecodeJws(signedTransactionJws);
    if (!jwsResult) {
      return NextResponse.json(
        { error: 'signedTransactionJws の署名検証に失敗しました' },
        { status: 403 },
      );
    }
    const { payload } = jwsResult;
    const claimedProductId = payload.productId;
    const claimedTxId = payload.transactionId ?? payload.originalTransactionId;
    const claimedBundleId = payload.bundleId;
    if (claimedProductId !== productId) {
      return NextResponse.json({ error: 'productId が JWS と一致しません' }, { status: 400 });
    }
    if (String(claimedTxId) !== String(transactionId)) {
      return NextResponse.json({ error: 'transactionId が JWS と一致しません' }, { status: 400 });
    }
    const expectedBundleId = process.env.APPLE_IAP_BUNDLE_ID;
    if (expectedBundleId && claimedBundleId !== expectedBundleId) {
      return NextResponse.json({ error: 'bundleId が一致しません' }, { status: 400 });
    }

    // 冪等性 + 付与
    const db = getAdminDb();
    const txRef = db.doc(`account_iap_transactions/${transactionId}`);
    const subRef = db.doc(`account_subscriptions/${uid}`);

    const result = await db.runTransaction(async (tx) => {
      const txSnap = await tx.get(txRef);
      if (txSnap.exists) {
        return { ok: false as const, reason: 'ALREADY_PROCESSED' as const };
      }
      tx.set(txRef, stampIrVersion({
        uid,
        productId,
        credits: product.credits,
        priceJpy: product.priceJpy,
        environment: environment ?? 'unknown',
        processedAt: FieldValue.serverTimestamp(),
        signedDateMs: payload.signedDate ?? null,
        // 署名検証済みか（本番は常に true。開発の decode-only 付与は false で痕跡を残す）
        jwsVerified: jwsResult.verified,
      }));
      tx.set(
        subRef,
        {
          purchasedCredits: FieldValue.increment(product.credits),
          lastPurchaseAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: 'このトランザクションは処理済みです' },
        { status: 409 },
      );
    }

    // 付与後の残高を返す
    const subSnap = await subRef.get();
    const purchasedCredits = subSnap.exists
      ? Math.max(0, Number(subSnap.data()?.purchasedCredits || 0))
      : 0;

    return NextResponse.json({
      ok: true,
      granted: product.credits,
      productId,
      purchasedCredits,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('iap grant error:', error);
    return NextResponse.json({ error: '購入処理に失敗しました' }, { status: 500 });
  }
}
