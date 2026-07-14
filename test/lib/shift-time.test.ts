import { describe, expect, it } from 'vitest';
import { resolveOvernightEndMs } from '../../src/lib/attendance/shift-time';

const H = (ms: number) => ms / (60 * 60 * 1000);

describe('resolveOvernightEndMs', () => {
  const start = new Date('2026-07-14T23:00:00').getTime();

  it('同暦日で end<start は翌日に送る（夜職の日跨ぎ）', () => {
    const endBase = new Date('2026-07-14T05:00:00').getTime(); // 同日05:00（start前）
    const resolved = resolveOvernightEndMs(start, endBase);
    expect(resolved).toBeGreaterThan(start);
    expect(H(resolved - start)).toBeCloseTo(6, 5); // 23:00→翌05:00 = 6h
  });

  it('end>start はそのまま（同日内勤務）', () => {
    const s = new Date('2026-07-14T20:00:00').getTime();
    const endBase = new Date('2026-07-14T23:30:00').getTime();
    expect(resolveOvernightEndMs(s, endBase)).toBe(endBase);
    expect(H(resolveOvernightEndMs(s, endBase) - s)).toBeCloseTo(3.5, 5);
  });

  it('end==start は翌日に送る（0分勤務にしない）', () => {
    const endBase = start;
    expect(resolveOvernightEndMs(start, endBase)).toBe(start + 24 * 60 * 60 * 1000);
  });
});
