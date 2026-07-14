import { describe, expect, it } from 'vitest';
import { businessDayKey, businessMonthKey, jstCalendarDate } from '../../src/lib/datetime';

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

describe('jstCalendarDate', () => {
  // UTC 入力（Z 明示）に対し JST(+9h) の暦日/曜日を返すこと
  it('UTC 深夜は JST では翌日（+9h）', () => {
    // 2026-07-13T20:00Z = 2026-07-14T05:00 JST
    expect(jstCalendarDate(new Date('2026-07-13T20:00:00Z')).date).toBe('2026-07-14');
  });
  it('JST 深夜0時境界（UTC 15:00）', () => {
    expect(jstCalendarDate(new Date('2026-07-13T15:00:00Z')).date).toBe('2026-07-14');
    expect(jstCalendarDate(new Date('2026-07-13T14:59:59Z')).date).toBe('2026-07-13');
  });
  it('曜日は JST 日付に一致（0=日）', () => {
    const { date, weekday } = jstCalendarDate(new Date('2026-07-13T20:00:00Z'));
    // 返す weekday は返す date の曜日と一致する（UTC 直読みのズレがない）
    expect(weekday).toBe(new Date(`${date}T00:00:00Z`).getUTCDay());
  });
});
