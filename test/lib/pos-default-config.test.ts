import { describe, expect, it } from 'vitest';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';

// POS 既定設定は手入力の相互参照データ（カテゴリ/半額ルール/pinned が menuItems の name を参照）。
// 参照ズレは実行時にサイレント回帰になる:
//  - PosClient は menuItemsByName.get(name) を .filter(!!m) するため、無い名前は「黙って表示から消える」
//  - engine は champagneNames.includes(name) && item.canHalfOff で半額判定するため、
//    champagneName と item.canHalfOff の不一致は「半額が発火しない」金銭バグになる
// これらの不変条件を将来の編集事故から守る（Day56）。

const config = createDefaultStoreConfig();
const menuNames = new Set(config.menuItems.map((m) => m.name));
const halfOffableNames = new Set(config.menuItems.filter((m) => m.canHalfOff).map((m) => m.name));

describe('createDefaultStoreConfig — 参照整合性の不変条件', () => {
  it('menuItems の name に重複が無い（Map 化で後勝ち上書き・参照曖昧化を防ぐ）', () => {
    const counts = new Map<string, number>();
    for (const m of config.menuItems) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    const dups = [...counts].filter(([, c]) => c > 1).map(([n]) => n);
    expect(dups).toEqual([]);
  });

  it('全カテゴリの参照商品が menuItems に実在する（PosClient で黙って消えない）', () => {
    const missing: string[] = [];
    for (const cat of config.menuCategories) {
      for (const name of cat.items) if (!menuNames.has(name)) missing.push(`${cat.id}:${name}`);
    }
    expect(missing).toEqual([]);
  });

  it('menuCategories の id が一意で、少なくとも1つ存在する（PosClient は [0] を既定タブにする）', () => {
    const ids = config.menuCategories.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('halfOffRules.champagneNames は全て menuItems に実在し canHalfOff=true（engine の半額発火条件）', () => {
    const notFound: string[] = [];
    const notHalfOff: string[] = [];
    for (const n of config.halfOffRules.champagneNames) {
      if (!menuNames.has(n)) notFound.push(n);
      else if (!halfOffableNames.has(n)) notHalfOff.push(n);
    }
    expect(notFound).toEqual([]);
    expect(notHalfOff).toEqual([]);
  });

  it('pinnedOrders の商品が menuItems に実在する', () => {
    const missing = config.pinnedOrders.filter((p) => !menuNames.has(p.name)).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  it('青→金レンジは下限 <= 上限', () => {
    expect(config.halfOffRules.blueToGoldMinPrice).toBeLessThanOrEqual(config.halfOffRules.blueToGoldMaxPrice);
  });
});

describe('createDefaultStoreConfig — 既定値の characterization', () => {
  it('id 既定は "active"（pos_config/active に書き込む前提）、引数で上書き可', () => {
    expect(createDefaultStoreConfig().id).toBe('active');
    expect(createDefaultStoreConfig('xyz').id).toBe('xyz');
  });

  it('storeName 既定は "店舗"、引数で上書き可', () => {
    expect(createDefaultStoreConfig().storeName).toBe('店舗');
    expect(createDefaultStoreConfig('active', 'GENTLY').storeName).toBe('GENTLY');
  });

  it('tableNames は非空かつ重複無し（卓 ID の一意性）', () => {
    expect(config.tableNames.length).toBeGreaterThan(0);
    expect(new Set(config.tableNames).size).toBe(config.tableNames.length);
  });

  it('taxRate は 0〜1 の範囲', () => {
    expect(config.taxRate).toBeGreaterThan(0);
    expect(config.taxRate).toBeLessThan(1);
  });

  it('全 menuItems の price は非負', () => {
    expect(config.menuItems.every((m) => m.price >= 0)).toBe(true);
  });
});
