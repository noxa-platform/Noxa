// Android Google Play Billing の購入完了通知から呼ばれて、クレジットを永続加算する API。
//
// 設計方針は iOS 版 /api/iap/grant と完全対称:
//   - 既存の account_iap_transactions/{transactionId} に冪等キーで書込（同一 token は 1 回のみ）
//   - 既存の account_subscriptions/{uid}.purchasedCredits を FieldValue.increment で加算
//   - 商品マスタは src/lib/iap/products.ts と共通（android product ID で逆引き）
//
// セキュリティ:
//   - クライアント申告の productId だけで付与はしない
//   - Google Play Developer API `/androidpublisher/v3/applications/.../purchases/products/.../tokens/...`
//     で **サーバ側署名検証** + purchaseState 1 (PURCHASED) チェック必須
//   - GOOGLE_PLAY_SERVICE_ACCOUNT_KEY（Service Account JSON 1 行圧縮）と
//     GOOGLE_PLAY_PACKAGE_NAME（packageName）を env から読む
//
// スケルトン状態:
//   - 現在は env 未設定時に NODE_ENV !== 'production' なら検証 skip で付与（dev 用）
//   - 実装の最終形は Capacitor IAP プラグイン導入 + Android AAB ビルド完了後の別タスク
//   - googleapis SDK の `androidpublisher_v3` を使う想定（既に package.json に入っている）

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { getIapProductByAndroidId } from '@/lib/iap/products';
import { FieldValue } from 'firebase-admin/firestore';

interface GrantBody {
  /** Android アプリの packageName（例: jp.egshugy.yorulog） */
  packageName: string;
  /** Google Play 側の product ID（IAP_PRODUCTS.android と突き合わせる） */
  productId: string;
  /** BillingClient が返す purchaseToken（数百文字。Apple の transactionId に相当） */
  purchaseToken: string;
  /** orderId（任意。Play 側のレシート ID） */
  orderId?: string;
}

interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** purchaseState: 0=PURCHASED, 1=CANCELED, 2=PENDING（Play Developer API 規約） */
  purchaseState?: number;
  /** consumption state: 0=YET_TO_BE_CONSUMED, 1=CONSUMED */
  consumptionState?: number;
  /** acknowledged: 0=NOT_ACKNOWLEDGED, 1=ACKNOWLEDGED */
  acknowledgementState?: number;
}

/**
 * Google Play Developer API で purchaseToken を検証する。
 *
 * 現状はスケルトン: env 未設定 + non-production なら skip して { ok: true }。
 * 本実装時は `googleapis` の `androidpublisher.purchases.products.get` を呼ぶ。
 */
async function verifyGooglePlayPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string,
): Promise<VerifyResult> {
  const saKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  if (!saKey) {
    // 検証skipは明示フラグ(IAP_ALLOW_UNVERIFIED=true)が立っているときのみ許可。
    // NODE_ENV依存だとPreview/staging環境で偽トークンによる不正付与を許してしまうため明示化。
    if (process.env.IAP_ALLOW_UNVERIFIED === 'true') {
      console.warn('verifyGooglePlayPurchase: IAP_ALLOW_UNVERIFIED=true のため検証skip（本番では絶対に設定しないこと）');
      return { ok: true, purchaseState: 0 };
    }
    return { ok: false, reason: 'Service Account 未設定（検証不可）' };
  }

  // TODO: googleapis SDK で実装
  //
  //   import { google } from 'googleapis';
  //   const auth = new google.auth.GoogleAuth({
  //     credentials: JSON.parse(saKey),
  //     scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  //   });
  //   const publisher = google.androidpublisher({ version: 'v3', auth });
  //   const { data } = await publisher.purchases.products.get({
  //     packageName, productId, token: purchaseToken,
  //   });
  //   return {
  //     ok: data.purchaseState === 0,
  //     purchaseState: data.purchaseState ?? undefined,
  //     consumptionState: data.consumptionState ?? undefined,
  //     acknowledgementState: data.acknowledgementState ?? undefined,
  //   };

  // パラメータは将来の実装時に使うため、形だけ参照しておく（未使用警告回避）
  void packageName;
  void productId;
  void purchaseToken;

  return { ok: false, reason: 'Google Play Developer API 連携未実装' };
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as GrantBody;
    const { packageName, productId, purchaseToken, orderId } = body;

    if (!packageName || !productId || !purchaseToken) {
      return NextResponse.json(
        { error: 'packageName / productId / purchaseToken は必須です' },
        { status: 400 },
      );
    }

    // packageName が env と一致するか確認（なりすまし防止）
    const expectedPackage = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    if (expectedPackage && packageName !== expectedPackage) {
      return NextResponse.json(
        { error: 'packageName が一致しません' },
        { status: 400 },
      );
    }

    // 商品マスタ突き合わせ（android product ID 経由）
    const product = getIapProductByAndroidId(productId);
    if (!product) {
      return NextResponse.json({ error: '未知の productId です' }, { status: 400 });
    }

    // Google Play Developer API で検証
    const verify = await verifyGooglePlayPurchase(packageName, productId, purchaseToken);
    if (!verify.ok) {
      return NextResponse.json(
        { error: `Google Play 検証失敗: ${verify.reason ?? 'unknown'}` },
        { status: 400 },
      );
    }
    if (verify.purchaseState !== undefined && verify.purchaseState !== 0) {
      // 1: CANCELED, 2: PENDING（保留中の家族承認など）
      return NextResponse.json(
        { error: `購入が完了状態ではありません（state=${verify.purchaseState}）` },
        { status: 409 },
      );
    }

    // 冪等性 + 付与
    // iOS と同じ crm_iap_transactions を冪等キー保管庫として使用。
    // 衝突しないよう Android は `gplay_<purchaseToken>` を transactionId にする。
    const transactionId = `gplay_${purchaseToken}`;
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
        platform: 'android',
        productId: product.productId,
        androidProductId: productId,
        purchaseToken,
        orderId: orderId ?? null,
        credits: product.credits,
        priceJpy: product.priceJpy,
        processedAt: FieldValue.serverTimestamp(),
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

    // TODO（本実装時）:
    //   - Play Developer API の purchases.products.consume を呼んで Play 側で消費完了化
    //     （consumable IAP は consume しないと再購入できない）
    //   - 失敗時は別途リトライキュー（Cloud Tasks 等）に積む

    return NextResponse.json({
      ok: true,
      granted: product.credits,
      productId: product.productId,
      purchasedCredits,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('iap google-play-grant error:', error);
    return NextResponse.json({ error: '購入処理に失敗しました' }, { status: 500 });
  }
}
