import { describe, expect, it } from 'vitest';
import { CUSTOMER_RANKS, rankToStars, starsToRank } from '../../src/lib/customerRank';

// 顧客ランク（SS/S/A/B/C ⇔ ★5〜1）——iOS 実データとの互換規約（Day25）

describe('rankToStars / starsToRank', () => {
  it('SS=5 … C=1 の対応', () => {
    expect(rankToStars('SS')).toBe(5);
    expect(rankToStars('S')).toBe(4);
    expect(rankToStars('A')).toBe(3);
    expect(rankToStars('B')).toBe(2);
    expect(rankToStars('C')).toBe(1);
  });
  it('未設定・未知値は 0（未評価）', () => {
    expect(rankToStars(null)).toBe(0);
    expect(rankToStars(undefined)).toBe(0);
    expect(rankToStars('')).toBe(0);
    expect(rankToStars('Z')).toBe(0);
  });
  it('starsToRank は 1〜5 のみランクを返し、0 や範囲外は空文字', () => {
    expect(starsToRank(5)).toBe('SS');
    expect(starsToRank(1)).toBe('C');
    expect(starsToRank(0)).toBe('');
    expect(starsToRank(6)).toBe('');
    expect(starsToRank(-1)).toBe('');
  });
  it('全ランクで往復が一致する', () => {
    for (const r of CUSTOMER_RANKS) {
      expect(starsToRank(rankToStars(r))).toBe(r);
    }
  });
});
