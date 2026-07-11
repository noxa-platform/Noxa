import { describe, expect, it } from 'vitest';
import { IAP_PRODUCTS, getIapProduct, getIapProductByAndroidId, getIapProductByIosId } from '../../src/lib/iap/products';

// IAP 商品マスタの不変条件——ID 規約が崩れると grant API とストア突き合わせが壊れる（Day26）

describe('IAP_PRODUCTS の不変条件', () => {
  it('productId は一意', () => {
    const ids = IAP_PRODUCTS.map((p) => p.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('命名規約 cr_<tier>_<credits> で、末尾の数字が credits と一致する', () => {
    for (const p of IAP_PRODUCTS) {
      const m = p.productId.match(/^cr_[a-z]+_(\d+)$/);
      expect(m, p.productId).not.toBeNull();
      expect(Number(m![1]), p.productId).toBe(p.credits);
    }
  });
  it('credits・priceJpy は正の数', () => {
    for (const p of IAP_PRODUCTS) {
      expect(p.credits, p.productId).toBeGreaterThan(0);
      expect(p.priceJpy, p.productId).toBeGreaterThan(0);
    }
  });
  it('クレジット単価は大口ほど安い（プラン設計の単調性）', () => {
    const unit = IAP_PRODUCTS.map((p) => p.priceJpy / p.credits);
    for (let i = 1; i < unit.length; i++) expect(unit[i], `${IAP_PRODUCTS[i].productId}`).toBeLessThan(unit[i - 1]);
  });
});

describe('逆引き', () => {
  it('productId / iOS / Android の各 ID で同じ商品に到達する', () => {
    for (const p of IAP_PRODUCTS) {
      expect(getIapProduct(p.productId)).toBe(p);
      expect(getIapProductByIosId(p.ios)).toBe(p);
      expect(getIapProductByAndroidId(p.android)).toBe(p);
    }
  });
  it('未知 ID は undefined', () => {
    expect(getIapProduct('cr_unknown_1')).toBeUndefined();
    expect(getIapProductByIosId('nope')).toBeUndefined();
  });
});
