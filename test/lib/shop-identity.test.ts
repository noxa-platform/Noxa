import { describe, it, expect } from 'vitest';
import { shopCodeFromId, isValidShopCode, normalizeShopCode } from '../../src/lib/shop-identity';

// 店舗の同一性（Day126）。
// 統一規格の芯は「同一性を名前で持たない」こと。店名は改名・業態変更・移転で変わるので、
// 名前で紐付けていると変えた瞬間に過去の売上・顧客・給与との繋がりが切れる。

describe('shopCodeFromId', () => {
  it('★同じ店舗 ID なら常に同じコード（改名しても不変）', () => {
    expect(shopCodeFromId('abc123')).toBe(shopCodeFromId('abc123'));
  });

  it('★導出なので既存店舗にも遡って同じコードが出る（移行スクリプト不要）', () => {
    // 保存済みの値が無くても表示側で同じ値を再現できることが要件
    const derived = shopCodeFromId('existing-shop-doc-id');
    expect(isValidShopCode(derived)).toBe(true);
    expect(shopCodeFromId('existing-shop-doc-id')).toBe(derived);
  });

  it('別の店舗は別のコードになる', () => {
    expect(shopCodeFromId('shop-a')).not.toBe(shopCodeFromId('shop-b'));
  });

  it('形式は NX-XXXX-XXXX', () => {
    expect(shopCodeFromId('anything')).toMatch(/^NX-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('★紛らわしい文字（I / L / O / U）を含まない（電話・手書きで伝えるため）', () => {
    const codes = Array.from({ length: 200 }, (_, i) => shopCodeFromId(`shop-${i}`));
    for (const c of codes) expect(c.replace(/^NX-/, '')).not.toMatch(/[ILOU]/);
  });

  it('200 件で衝突しない', () => {
    const codes = new Set(Array.from({ length: 200 }, (_, i) => shopCodeFromId(`shop-${i}`)));
    expect(codes.size).toBe(200);
  });

  it('空の ID は空文字（呼び出し側が未確定の店舗を表示しない）', () => {
    expect(shopCodeFromId('')).toBe('');
    expect(shopCodeFromId('   ')).toBe('');
  });
});

describe('normalizeShopCode（帳票・口頭からの入力を吸収）', () => {
  it('小文字・区切り無し・空白を吸収する', () => {
    const code = shopCodeFromId('shop-x');
    const body = code.replace(/^NX-/, '').replace('-', '');
    expect(normalizeShopCode(body.toLowerCase())).toBe(code);
    expect(normalizeShopCode(` ${code} `)).toBe(code);
    expect(normalizeShopCode(code.replace(/-/g, ''))).toBe(code);
  });

  it('★桁数が違う入力は受け付けない（似た番号を黙って通さない）', () => {
    expect(normalizeShopCode('NX-123')).toBeNull();
    expect(normalizeShopCode('')).toBeNull();
    expect(normalizeShopCode('NX-ABCD-ABCDE')).toBeNull();
  });

  it('紛らわしい文字を含む入力は無効（誤読をそのまま通さない）', () => {
    expect(normalizeShopCode('NX-IIII-OOOO')).toBeNull();
  });
});
