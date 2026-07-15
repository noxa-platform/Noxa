import { describe, it, expect } from 'vitest';
import { nextStockQty, parseRemainingPct, nextRemainingPct } from '../../src/lib/inventory/adjust';

describe('nextStockQty', () => {
  it('増減を適用する', () => {
    expect(nextStockQty(10, 1)).toBe(11);
    expect(nextStockQty(10, -3)).toBe(7);
  });
  it('0 未満にはしない（在庫のマイナス表示を防ぐ）', () => {
    expect(nextStockQty(0, -1)).toBe(0);
    expect(nextStockQty(2, -5)).toBe(0);
  });
  it('非数値は 0 に丸めて事故らせない', () => {
    expect(nextStockQty(Number.NaN, 3)).toBe(3);
    expect(nextStockQty(5, Number.NaN)).toBe(5);
  });
});

describe('parseRemainingPct', () => {
  it('"65%" 等から数値を取り出す', () => {
    expect(parseRemainingPct('65%')).toBe(65);
    expect(parseRemainingPct('半分50%くらい')).toBe(50);
  });
  it('0-100 でクランプ', () => {
    expect(parseRemainingPct('150%')).toBe(100);
  });
  it('数字が無ければ null（未記録）', () => {
    expect(parseRemainingPct('半分')).toBeNull();
    expect(parseRemainingPct('')).toBeNull();
    expect(parseRemainingPct(null)).toBeNull();
    expect(parseRemainingPct(undefined)).toBeNull();
  });
});

describe('nextRemainingPct', () => {
  it('±delta を適用し 0-100 でクランプ', () => {
    expect(nextRemainingPct(50, 10)).toBe(60);
    expect(nextRemainingPct(5, -10)).toBe(0);
    expect(nextRemainingPct(95, 10)).toBe(100);
  });
  it('未記録(null)は 100% から開始（記録開始 delta=0 で 100）', () => {
    expect(nextRemainingPct(null, 0)).toBe(100);
    expect(nextRemainingPct(null, -10)).toBe(90);
  });
});
