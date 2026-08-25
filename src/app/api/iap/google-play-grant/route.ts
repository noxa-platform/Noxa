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
// 実装状態（Day11 で consume まで完了）:
//   - 検証: androidpublisher v3 purchases.products.get（本番は Service Account 必須・skip 不可）
//   - 付与後に purchases.products.consume を呼ぶ（consumable は consume しないと同一商品を
//     再購入できず、未 acknowledge のまま3日で Play が自動返金する。consume は acknowledge を兼ねる）
//   - consume 失敗は付与を巻き戻さない（付与済みの方が安全側）。レスポンス consumed で通知し、
//     クライアント側は次回起動時の購入復元で再度 grant → ALREADY_PROCESSED → consume 再試行できる
//   - 残: Capacitor IAP プラグイン導入 + Android AAB ビルド（docs/android-rollout-checklist.md）

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, getAdminDb, AuthError } from '../../lib/firebase-admin';
import { getIapProductByAndroidId } from '@/lib/iap/products';
import { FieldValue } from 'firebase-admin/firestore';
import { stampIrVersion } from '@/lib/ir-version';
import { readPlayPurchaseKind } from '@/lib/iap/transaction-facts';

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
  /** Play Developer API に実際に問い合わせて答えが返ったか（検証 skip と区別する） */
  verified?: boolean;
  /** purchaseState: 0=PURCHASED, 1=CANCELED, 2=PENDING（Play Developer API 規約） */
  purchaseState?: number;
  /** consumption state: 0=YET_TO_BE_CONSUMED, 1=CONSUMED */
  consumptionState?: number;
  /** acknowledged: 0=NOT_ACKNOWLEDGED, 1=ACKNOWLEDGED */
  acknowledgementState?: number;
  /**
   * purchaseType: 0=Test（ライセンステスター）/ 1=Promo / 2=Rewarded。
   * **通常購入では項目自体が返らない**のが Play の仕様＝欠落が実購入。
   * Apple の `environment: Sandbox` に当たる値で、これまで一切記録していなかった。
   */
  purchaseType?: number;
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
    // 検証skipは「明示フラグ + 非本番」の両方を満たすときのみ許可。
    // 本番(NODE_ENV==='production')では IAP_ALLOW_UNVERIFIED が設定されていても
    // 絶対に skip しない（誤設定による金銭事故を構造的に防ぐ）。
    if (process.env.IAP_ALLOW_UNVERIFIED === 'true' && process.env.NODE_ENV !== 'production') {
      console.warn('verifyGooglePlayPurchase: IAP_ALLOW_UNVERIFIED=true のため検証skip（非本番のみ有効）');
      // 検証を飛ばした以上「通常購入」とは言えない。verified: false で区別する
      return { ok: true, verified: false, purchaseState: 0 };
    }
    return { ok: false, reason: 'Service Account 未設定（検証不可）' };
  }

  // googleapis (androidpublisher v3) で purchaseToken を実検証する
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(saKey),
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const publisher = google.androidpublisher({ version: 'v3', auth });
    const { data } = await publisher.purchases.products.get({
      packageName,
      productId,
      token: purchaseToken,
    });
    return {
      ok: data.purchaseState === 0,
      verified: true,
      purchaseState: data.purchaseState ?? undefined,
      consumptionState: data.consumptionState ?? undefined,
      acknowledgementState: data.acknowledgementState ?? undefined,
      purchaseType: data.purchaseType ?? undefined,
      ...(data.purchaseState !== 0 ? { reason: `purchaseState=${data.purchaseState}` } : {}),
    };
  } catch (e) {
    console.error('verifyGooglePlayPurchase: androidpublisher 検証エラー', e);
    return { ok: false, reason: 'Google Play 検証 API 呼び出しに失敗' };
  }
}

/**
 * consumable の消費完了化（best-effort）。
 * Service Account 未設定（dev skip 時）は何もしない。失敗しても付与は成立させる。
 */
async function consumeGooglePlayPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string,
): Promise<boolean> {
  const saKey = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  if (!saKey) return false;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(saKey),
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const publisher = google.androidpublisher({ version: 'v3', auth });
    await publisher.purchases.products.consume({ packageName, productId, token: purchaseToken });
    return true;
  } catch (e) {
    console.error('consumeGooglePlayPurchase: consume 失敗（付与は成立済み・復元フローで再試行可能）', e);
    return false;
  }
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
    // Play が実際に答えたときだけ素性を断定できる。検証 skip 時の「項目が無い」は
    // 「通常購入」ではなく**分からない**（欠落を肯定の根拠にしない）
    const verifiedByPlay = verify.verified === true;
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
      tx.set(txRef, stampIrVersion({
        uid,
        platform: 'android',
        productId: product.productId,
        androidProductId: productId,
        purchaseToken,
        orderId: orderId ?? null,
        credits: product.credits,
        priceJpy: product.priceJpy,
        // 素性（Play 由来）。テスト購入かどうかがこれまで記録に残っておらず、
        // 後から「本物の購入か」を判断できなかった（iOS 側と同じ穴・2026-08-25 の是正）。
        // **付与の可否には使わない**（テスト購入を弾くと審査とテスターが詰まる）
        purchaseKind: verifiedByPlay ? readPlayPurchaseKind(verify.purchaseType) : 'unknown',
        environmentSource: verifiedByPlay ? 'play-api' : 'unverified',
        processedAt: FieldValue.serverTimestamp(),
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
      // 処理済みでも Play 側が未消費なら consume だけ再試行する
      // （前回 consume に失敗していても、購入復元→再 grant の流れでここに来て自己修復できる）
      let consumed = verify.consumptionState === 1;
      if (!consumed) consumed = await consumeGooglePlayPurchase(packageName, productId, purchaseToken);
      return NextResponse.json(
        { error: 'このトランザクションは処理済みです', consumed },
        { status: 409 },
      );
    }

    // Play 側の消費完了化（consumable の再購入ブロック＋3日自動返金の回避。acknowledge を兼ねる）
    const consumed = await consumeGooglePlayPurchase(packageName, productId, purchaseToken);

    // 付与後の残高を返す
    const subSnap = await subRef.get();
    const purchasedCredits = subSnap.exists
      ? Math.max(0, Number(subSnap.data()?.purchasedCredits || 0))
      : 0;

    return NextResponse.json({
      ok: true,
      granted: product.credits,
      productId: product.productId,
      purchasedCredits,
      consumed, // false の場合クライアントは購入復元フローで再試行（付与は済んでいる）
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('iap google-play-grant error:', error);
    return NextResponse.json({ error: '購入処理に失敗しました' }, { status: 500 });
  }
}
