import { describe, expect, it } from 'vitest';
import { businessDayKey, businessMonthKey, jstCalendarDate, jstDayWindow, toMillis } from '../../src/lib/datetime';

// 営業日キー（深夜6時切替・JST）——POS 書込と売上集計の両方が従う日付規約の心臓部（Day25）。
// Day46: 入力は全て絶対時刻(Z 明示)で書く。これによりランナーの TZ に関係なく
// 「JST の 6 時境界」を検証でき、端末ローカル依存だった旧テストの脆さを排除する。
// コメントの JST 時刻 = その UTC 瞬間の日本時間。

describe('businessDayKey', () => {
  it('JST 6時以降はその営業日', () => {
    // JST 2026-07-11 06:00 = UTC 2026-07-10 21:00
    expect(businessDayKey(new Date('2026-07-10T21:00:00Z'))).toBe('2026-07-11');
    // JST 2026-07-11 20:30 = UTC 2026-07-11 11:30
    expect(businessDayKey(new Date('2026-07-11T11:30:00Z'))).toBe('2026-07-11');
    // JST 昼12時 = UTC 03:00
    expect(businessDayKey(new Date('2026-07-11T03:00:00Z'))).toBe('2026-07-11');
  });

  it('JST 深夜0時〜5:59 は前営業日（夜職の営業日）', () => {
    // JST 2026-07-11 00:00 = UTC 2026-07-10 15:00
    expect(businessDayKey(new Date('2026-07-10T15:00:00Z'))).toBe('2026-07-10');
    // JST 2026-07-11 05:59 = UTC 2026-07-10 20:59
    expect(businessDayKey(new Date('2026-07-10T20:59:59Z'))).toBe('2026-07-10');
  });

  it('月初の JST 深夜は前月末に落ちる', () => {
    // JST 2026-07-01 03:00 = UTC 2026-06-30 18:00
    expect(businessDayKey(new Date('2026-06-30T18:00:00Z'))).toBe('2026-06-30');
  });

  it('元日の JST 深夜は前年の大晦日に落ちる', () => {
    // JST 2026-01-01 04:00 = UTC 2025-12-31 19:00
    expect(businessDayKey(new Date('2025-12-31T19:00:00Z'))).toBe('2025-12-31');
  });

  it('ゼロ埋め（1桁月・1桁日）', () => {
    // JST 2026-03-05 12:00 = UTC 2026-03-05 03:00
    expect(businessDayKey(new Date('2026-03-05T03:00:00Z'))).toBe('2026-03-05');
  });

  // ─ Day46 回帰: 端末TZ非依存で JST 6時境界に固定（旧実装は getHours 等の端末ローカル依存）─
  it('UTC 深夜0時は JST 9時＝当日営業日（サーバ/非JST端末でもズレない）', () => {
    // 旧実装の穴: UTC の getHours()=0<6 で前日に誤って落ちていた
    expect(businessDayKey(new Date('2026-07-11T00:00:00Z'))).toBe('2026-07-11');
  });

  // ─ Day46-PM: 6時ちょうどは当日側（境界は inclusive）・直前ミリ秒は前日 ─
  it('JST 6:00:00 ちょうどは当日、5:59:59.999 は前日（境界の inclusive 検証）', () => {
    // JST 06:00:00.000 = UTC 前日 21:00:00.000
    expect(businessDayKey(new Date('2026-07-10T21:00:00.000Z'))).toBe('2026-07-11');
    // JST 05:59:59.999 = UTC 前日 20:59:59.999
    expect(businessDayKey(new Date('2026-07-10T20:59:59.999Z'))).toBe('2026-07-10');
  });
});

describe('businessMonthKey', () => {
  it('営業日基準の YYYY-MM（月初 JST 深夜は前月）', () => {
    // JST 2026-07-15 22:00 = UTC 2026-07-15 13:00
    expect(businessMonthKey(new Date('2026-07-15T13:00:00Z'))).toBe('2026-07');
    // JST 2026-07-01 02:00 = UTC 2026-06-30 17:00 → 営業日 06-30 → 2026-06
    expect(businessMonthKey(new Date('2026-06-30T17:00:00Z'))).toBe('2026-06');
    // JST 2026-07-01 07:00 = UTC 2026-06-30 22:00 → 6時超え → 07-01 → 2026-07
    expect(businessMonthKey(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07');
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

describe('jstDayWindow — JST 今日1日分の絶対時刻ウィンドウ（Day46-PM）', () => {
  it('JST 暦日 00:00〜翌00:00 を UTC Z で返す（= 前日15:00Z 〜 当日15:00Z）', () => {
    // JST 2026-07-14 の 1 日分。JST 00:00 = UTC 前日 15:00
    const { startIso, endIso } = jstDayWindow(new Date('2026-07-13T20:00:00Z')); // JST 07-14 05:00
    expect(startIso).toBe('2026-07-13T15:00:00.000Z');
    expect(endIso).toBe('2026-07-14T15:00:00.000Z');
  });

  it('UTC 昼でも JST 当日の窓になる（サーバ UTC でもズレない）', () => {
    // JST 2026-07-14 12:00 = UTC 2026-07-14 03:00 → 窓は JST 07-14
    const { startIso, endIso } = jstDayWindow(new Date('2026-07-14T03:00:00Z'));
    expect(startIso).toBe('2026-07-13T15:00:00.000Z');
    expect(endIso).toBe('2026-07-14T15:00:00.000Z');
  });

  it('窓幅は常に24時間', () => {
    const { startIso, endIso } = jstDayWindow(new Date('2026-07-14T03:00:00Z'));
    expect(new Date(endIso).getTime() - new Date(startIso).getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('toMillis — 時刻をミリ秒へ揃える（P153-PM12）', () => {
  // ⚠️ **緩い側に揃えた**ことを固定する。以前は画面ごとに写しがあり、
  // number を受ける実装（勤怠・送迎・給与）と受けない実装（通知・売上・顧客）に割れていて、
  // **同じ値を書いても画面によって出たり「—」になったり**していた（nomishugy 移行 P46 の実害）。
  it('Firestore Timestamp（toMillis を持つ）を受ける', () => {
    expect(toMillis({ toMillis: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it('seconds だけ持つ形（シリアライズされた Timestamp）も受ける', () => {
    expect(toMillis({ seconds: 1_700_000_000, nanoseconds: 0 })).toBe(1_700_000_000_000);
  });

  it('**number（ミリ秒）を受ける**——ここを弾くと既存データの表示が消える', () => {
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMillis(0)).toBe(0); // 1970 も「値がある」なので null にしない
  });

  // ⚠️ **fail-closed へ倒す前に網を広げる**（nomishugy 部隊の指摘）。読める形が狭いまま
  // 「読めなければ期限切れ」にすると、**有効な期限を落とす**という逆向きの事故になる。
  it('ISO 8601 の文字列を受ける（calendar のトークン期限が ISO 保存）', () => {
    expect(toMillis('2026-08-26T00:00:00.000Z')).toBe(Date.parse('2026-08-26T00:00:00.000Z'));
    expect(toMillis('2026-08-26T09:00:00+09:00')).toBe(Date.parse('2026-08-26T09:00:00+09:00'));
    expect(toMillis('  2026-08-26T00:00:00Z  ')).toBe(Date.parse('2026-08-26T00:00:00Z'));
  });

  it('ISO の形をしていない文字列は null（「7」が年や日に化けるのを防ぐ）', () => {
    for (const v of ['7', '2026', '2026-08-26', '明日', 'Aug 26 2026', '26/08/2026']) {
      expect(toMillis(v)).toBeNull();
    }
  });

  it('Date も受ける', () => {
    expect(toMillis(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
  });

  it('分からないものは **null**（0 に倒すと 1970-01-01 という意味のある時刻に化ける）', () => {
    for (const v of [null, undefined, '', 'あとで', {}, [], NaN, Infinity, new Date('壊れた')]) {
      expect(toMillis(v)).toBeNull();
    }
  });

  it('toMillis() が数値を返さない偽物は null（例外にしない）', () => {
    expect(toMillis({ toMillis: () => 'いつか' })).toBeNull();
    expect(toMillis({ seconds: 'たぶん' })).toBeNull();
  });
});
