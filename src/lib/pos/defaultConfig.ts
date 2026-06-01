import type { StoreConfig } from './types';

/**
 * POS 店舗設定の既定テンプレート。
 * host-club-calculator の GENTLY DIVA 設定を「動作確認済みの初期値」として流用。
 * NOXA では店舗登録時にこれを雛形として shop_shops/{shopId}/pos_config/active に
 * 書き込み、storeName / tableNames / 料金などを店舗ごとに編集する。
 */
export function createDefaultStoreConfig(id?: string, storeName?: string): StoreConfig {
  return {
    id: id ?? 'active',
    storeName: storeName ?? '店舗',
    tableNames: ['A', 'B-1', 'B-2', 'C-1', 'C-2', 'D', 'E-1', 'E-2', 'E-3'],

    initialPricing: { set: 1000, ext: 2000, nom: 1000, tc: 0 },
    rWithinPricing: { set: 0, ext: 1000, nom: 1000, tc: 0 },
    rAfterPricing: { set: 2000, ext: 1000, nom: 1000, tc: 500 },
    regularPricing: { earlySet: 2000, lateSet: 5000, ext: 3000, nom: 3000, tc: 500, thresholdHour: 21 },
    initialSetPriceOptions: [0, 1000, 3000, 5000],

    menuItems: [
      { name: 'カン', price: 1500, canHalfOff: true },
      { name: 'ペットボトル', price: 2000 },
      { name: 'ソフトドリンク', price: 500 },
      { name: 'ショット系', price: 2000, canHalfOff: true },
      { name: '1800', price: 3000 },
      { name: 'コカボム', price: 3000 },
      { name: '茉莉花', price: 15000 },
      { name: 'オリシャン / その他', price: 0, isCustom: true },
      { name: 'ハーフ杏露酒 / 林檎酒', price: 3500 },
      { name: 'ハーフ焼酎 〈芋.麦〉 梅酒', price: 4200 },
      { name: 'ハーフ鏡月', price: 5000 },
      { name: 'JAPAN', price: 15000 },
      { name: '鍛高譚', price: 15000 },
      { name: '黒霧島', price: 15000 },
      { name: '吉四六', price: 22000 },
      { name: 'カクテル', price: 1000 },
      { name: 'レッドブル', price: 1500 },
      { name: 'テキーラスタンド（12）', price: 22000 },
      { name: 'テキーラスタンド（16）', price: 28000 },
      { name: 'テキーラスタンドVIP', price: 45000 },
      { name: 'リステル', price: 20000, canHalfOff: true },
      { name: 'アスティ', price: 28000, canHalfOff: true },
      { name: 'SPLブルー', price: 35000, canHalfOff: true },
      { name: 'SPLホワイト', price: 50000, canHalfOff: true },
      { name: 'SPLパープル', price: 50000, canHalfOff: true },
      { name: 'SPLロゼ', price: 80000, canHalfOff: true },
      { name: 'SPLジュエルワイン', price: 80000, canHalfOff: true },
      { name: 'SPLZERO', price: 100000, canHalfOff: true },
      { name: 'SPLレッド', price: 100000, canHalfOff: true },
      { name: 'SPLゴールド', price: 150000, canHalfOff: true },
      { name: 'SPLルミナス', price: 200000 },
      { name: 'SPLブラック', price: 250000 },
      { name: 'SPLマグナム', price: 300000 },
      { name: 'SPLエメラルド', price: 350000 },
      { name: 'SPLルミナスマグナム', price: 400000 },
      { name: 'SPLプラチナ', price: 450000 },
      { name: 'セブンラックタワー', price: 111100 },
    ],

    menuCategories: [
      { id: 'standard', label: '定番', items: ['ソフトドリンク', '1800', 'コカボム', '茉莉花', 'カクテル', 'レッドブル'] },
      { id: 'champagne', label: 'シャンパン', items: ['リステル', 'アスティ', 'SPLブルー', 'SPLホワイト', 'SPLパープル', 'SPLロゼ', 'SPLジュエルワイン', 'SPLZERO', 'SPLレッド', 'SPLゴールド', 'SPLルミナス', 'SPLブラック', 'SPLマグナム', 'SPLエメラルド', 'SPLルミナスマグナム', 'SPLプラチナ'] },
      { id: 'shochu', label: '焼酎/果実酒', items: ['ハーフ杏露酒 / 林檎酒', 'ハーフ焼酎 〈芋.麦〉 梅酒', 'ハーフ鏡月', 'JAPAN', '鍛高譚', '黒霧島', '吉四六'] },
      { id: 'special', label: '特殊/タワー', items: ['オリシャン / その他', 'テキーラスタンド（12）', 'テキーラスタンド（16）', 'テキーラスタンドVIP', 'セブンラックタワー'] },
    ],

    pinnedOrders: [
      { name: 'カン', price: 1500, canHalfOff: true },
      { name: 'ペットボトル', price: 2000 },
      { name: 'ショット系', price: 2000, canHalfOff: true, defaultIsHalfOff: true },
    ],

    taxRate: 0.35,
    initialNoOrderTaxRate: 0,
    dohanFee: 3000,
    additionalNominationFee: 3000,

    closingHour: 25,
    loCapNormalizedMins: 24 * 60 + 38,

    goldTicket: { setOverride: 0, extOverride: 1000 },
    halfOffRules: {
      champagneNames: ['リステル', 'アスティ', 'SPLブルー', 'SPLホワイト', 'SPLパープル', 'SPLロゼ', 'SPLジュエルワイン', 'SPLZERO', 'SPLレッド', 'SPLゴールド'],
      blueToGoldMinPrice: 35000,
      blueToGoldMaxPrice: 150000,
      initialROneBottleLimit: true,
      canSpecialPrice: 700,
    },
  };
}
