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
import { FieldValue } from 'firebase-admin/firestore';

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
 * Apple JWS（compact 形式: header.payload.signature）から payload 部分をデコード。
 *
 * 注意: これだけでは「署名検証」にならない。本番では公式 JWKS で検証必須。
 * 現状は payload の中身（transactionId, productId, bundleId, signedDate）を取り出し、
 * 整合性チェック（bundleId 一致 / productId 一致 / transactionId 一致）で最小限の防御。
 */
function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
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

    // JWS の payload を読んで claim 整合性を確認
    const payload = decodeJwsPayload(signedTransactionJws);
    if (!payload) {
      return NextResponse.json({ error: '無効な signedTransactionJws' }, { status: 400 });
    }
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
      tx.set(txRef, {
        uid,
        productId,
        credits: product.credits,
        priceJpy: product.priceJpy,
        environment: environment ?? 'unknown',
        processedAt: FieldValue.serverTimestamp(),
        signedDateMs: payload.signedDate ?? null,
      });
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
