import { describe, expect, it } from 'vitest';
import { businessDayKey, businessMonthKey } from '../../src/lib/datetime';

// 営業日キー（深夜6時切替）——POS 書込と売上集計の両方が従う日付規約の心臓部（Day25）

describe('businessDayKey', () => {
  it('6時以降はその日', () => {
    expect(businessDayKey(new Date('2026-07-11T06:00:00'))).toBe('2026-07-11');
    expect(businessDayKey(new Date('2026-07-11T20:30:00'))).toBe('2026-07-11');
  });
  it('深夜0時〜5:59 は前日扱い（夜職の営業日）', () => {
    expect(businessDayKey(new Date('2026-07-11T00:00:00'))).toBe('2026-07-10');
    expect(businessDayKey(new Date('2026-07-11T05:59:59'))).toBe('2026-07-10');
  });
  it('月初の深夜は前月末に落ちる', () => {
    expect(businessDayKey(new Date('2026-07-01T03:00:00'))).toBe('2026-06-30');
  });
  it('元日の深夜は前年の大晦日に落ちる', () => {
    expect(businessDayKey(new Date('2026-01-01T04:00:00'))).toBe('2025-12-31');
  });
  it('ゼロ埋め（1桁月・1桁日）', () => {
    expect(businessDayKey(new Date('2026-03-05T12:00:00'))).toBe('2026-03-05');
  });
});

describe('businessMonthKey', () => {
  it('営業日基準の YYYY-MM（月初深夜は前月）', () => {
    expect(businessMonthKey(new Date('2026-07-15T22:00:00'))).toBe('2026-07');
    expect(businessMonthKey(new Date('2026-07-01T02:00:00'))).toBe('2026-06');
  });
});
