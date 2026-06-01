/**
 * POS 店舗設定の型定義。
 * host-club-calculator（伝票計算エンジン）から移植。NOXA では shop ごとに
 * shop_shops/{shopId}/pos_config/active として Firestore に保存する。
 */

export interface CustomerTypePricing {
  set: number;
  ext: number;
  nom: number;
  tc: number;
}

export interface RegularPricing {
  earlySet: number;
  lateSet: number;
  ext: number;
  nom: number;
  tc: number;
  thresholdHour: number;
}

export interface MenuItemDef {
  name: string;
  price: number;
  canHalfOff?: boolean;
  isTaxIncluded?: boolean;
  isCustom?: boolean;
}

export interface MenuCategoryDef {
  id: string;
  label: string;
  items: string[];
}

export interface PinnedOrderDef {
  name: string;
  price: number;
  canHalfOff?: boolean;
  defaultIsHalfOff?: boolean;
}

export interface GoldTicketConfig {
  setOverride: number;
  extOverride: number;
}

export interface HalfOffRules {
  champagneNames: string[];
  blueToGoldMinPrice: number;
  blueToGoldMaxPrice: number;
  initialROneBottleLimit: boolean;
  canSpecialPrice: number;
}

export interface StoreConfig {
  id: string;
  storeName: string;
  tableNames: string[];

  // 客層別料金
  initialPricing: CustomerTypePricing;
  rWithinPricing: CustomerTypePricing;
  rAfterPricing: CustomerTypePricing;
  regularPricing: RegularPricing;
  initialSetPriceOptions: number[];

  // メニュー
  menuItems: MenuItemDef[];
  menuCategories: MenuCategoryDef[];
  pinnedOrders: PinnedOrderDef[];

  // 税・手数料
  taxRate: number;
  initialNoOrderTaxRate: number;
  dohanFee: number;
  additionalNominationFee: number;

  // 時間
  closingHour: number;
  loCapNormalizedMins: number;

  // 特殊ルール
  goldTicket: GoldTicketConfig;
  halfOffRules: HalfOffRules;
}
