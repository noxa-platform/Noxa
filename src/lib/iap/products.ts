// In-App Purchase 商品マスタ。iOS StoreKit 2 / Android Google Play Billing で共通利用。
//
// すべて **consumable**（1 回限り消費 / 復元不可）扱い。購入後 grant 系 API で
// account_subscriptions/{uid}.purchasedCredits に永続加算する。
//
// 価格は App Store Connect / Google Play Console の Price Tier に揃え、プラットフォーム
// 30% 手数料を引いた実入金で粗利率 90% 前後を確保するように設計（原価 ≒ ¥0.05/cr）。
//
// productId 命名: `cr_<tier>_<credits>`
//   tier: starter / standard / value / pro
//   credits: 付与クレジット数（数字のみ）
//
// iOS / Android アプリは GET /api/iap/products でこのマスタを取得し、
// StoreKit / Play Billing の productIdentifiers と突き合わせる。
//
// 2026-05-18: Stripe 廃止に伴い iOS/Android の product ID マッピングを明示化。
// iOS 側 product ID は App Store Connect 登録済み、Android 側は Google Play Console
// 登録待ち（同一 ID を使用する想定）。

export interface IapProduct {
  /** 共通 product ID（iOS / Android で同一にする運用） */
  productId: string;
  /** UI 表示名 */
  title: string;
  /** UI 表示の短い説明 */
  subtitle: string;
  /** 付与クレジット数 */
  credits: number;
  /** 表示用の JPY 価格（参考値、最終的には StoreKit / Play Billing 取得値を表示） */
  priceJpy: number;
  /** 推奨表示マーク（"おすすめ" / "お得" 等） */
  badge?: string;
  /** iOS App Store Connect 側の product ID（基本は productId と同一） */
  ios: string;
  /** Android Google Play Console 側の product ID（基本は productId と同一） */
  android: string;
}

export const IAP_PRODUCTS: readonly IapProduct[] = [
  {
    productId: 'cr_starter_250',
    title: 'スターター',
    subtitle: '250 クレジット',
    credits: 250,
    priceJpy: 320,
    ios: 'cr_starter_250',
    android: 'cr_starter_250',
  },
  {
    productId: 'cr_standard_1000',
    title: 'スタンダード',
    subtitle: '1,000 クレジット',
    credits: 1000,
    priceJpy: 980,
    badge: 'おすすめ',
    ios: 'cr_standard_1000',
    android: 'cr_standard_1000',
  },
  {
    productId: 'cr_value_4000',
    title: 'バリュー',
    subtitle: '4,000 クレジット',
    credits: 4000,
    priceJpy: 3000,
    badge: 'お得',
    ios: 'cr_value_4000',
    android: 'cr_value_4000',
  },
  {
    productId: 'cr_pro_15000',
    title: 'プロ',
    subtitle: '15,000 クレジット',
    credits: 15000,
    priceJpy: 9800,
    ios: 'cr_pro_15000',
    android: 'cr_pro_15000',
  },
] as const;

export type IapProductId = (typeof IAP_PRODUCTS)[number]['productId'];

export function getIapProduct(productId: string): IapProduct | undefined {
  return IAP_PRODUCTS.find((p) => p.productId === productId);
}

/** iOS product ID から逆引き */
export function getIapProductByIosId(iosId: string): IapProduct | undefined {
  return IAP_PRODUCTS.find((p) => p.ios === iosId);
}

/** Android product ID から逆引き */
export function getIapProductByAndroidId(androidId: string): IapProduct | undefined {
  return IAP_PRODUCTS.find((p) => p.android === androidId);
}
