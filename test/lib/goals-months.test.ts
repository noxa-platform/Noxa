import { describe, expect, it } from 'vitest';
import { currentBusinessYm, lastSixMonths } from '../../src/lib/goals/months';

describe('currentBusinessYm', () => {
  it('日中は暦月と一致', () => {
    expect(currentBusinessYm(new Date('2026-07-15T22:00:00'))).toBe('2026-07');
  });
  it('月初深夜（0〜6時）は前営業月', () => {
    expect(currentBusinessYm(new Date('2026-08-01T02:00:00'))).toBe('2026-07');
    expect(currentBusinessYm(new Date('2026-08-01T05:59:59'))).toBe('2026-07');
  });
  it('月初 6時以降は当月', () => {
    expect(currentBusinessYm(new Date('2026-08-01T06:00:00'))).toBe('2026-08');
  });
});

describe('lastSixMonths', () => {
  it('当月を末尾に古い順6件', () => {
    const r = lastSixMonths(new Date('2026-07-15T22:00:00'));
    expect(r.map((x) => x.ym)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(r[5].label).toBe('7月');
    expect(r).toHaveLength(6);
  });
  it('年跨ぎ（1月時点で前年を含む）', () => {
    const r = lastSixMonths(new Date('2026-01-10T12:00:00'));
    expect(r.map((x) => x.ym)).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  });
  it('月初深夜は前営業月を末尾にする（sales の dayKey と一致）', () => {
    // 8/1 02:00 は営業日 7/31 → 当月は 2026-07 が末尾（2026-08 ではない）
    const r = lastSixMonths(new Date('2026-08-01T02:00:00'));
    expect(r[5].ym).toBe('2026-07');
    expect(r.map((x) => x.ym)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
  });
});
