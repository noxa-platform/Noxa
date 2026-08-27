import { describe, it, expect } from 'vitest';
import { resolveScheduleDate } from '@/lib/schedule/item-date';

// P156: `personal_reminders/{uid}/items` は **Web と iOS が共有**しているのに書き方が違う。
// Web は `date: "YYYY-MM-DD"`、iOS（AI 経由の自動生成）は `dueAt`（Timestamp）。
// 旧実装は `d.date` しか見ておらず、iOS の予定は `date: ''` → 画面の
// `date >= today` が必ず偽 → **全部「過去」へ落ち、日付欄が空のまま並んでいた**。
// 消えてはいないが**嘘の場所に出ていた**。

/** Firestore の Timestamp を模す（toMillis を持つ形） */
const ts = (ms: number) => ({ toMillis: () => ms });
// 2026-08-28 03:00 JST（UTC では前日 18:00）。UTC 直読みだと 08-27 にずれる
const JST_EARLY_MORNING = Date.UTC(2026, 7, 27, 18, 0, 0);

describe('resolveScheduleDate — Web と iOS の 2 つの書き方を読む', () => {
  it('Web の `date` はそのまま使う', () => {
    expect(resolveScheduleDate({ date: '2026-08-28' })).toBe('2026-08-28');
    expect(resolveScheduleDate({ date: '  2026-08-28  ' })).toBe('2026-08-28');
  });

  it('iOS の `dueAt`（Timestamp）を暦日に読み替える', () => {
    expect(resolveScheduleDate({ dueAt: ts(Date.UTC(2026, 7, 28, 3, 0, 0)) })).toBe('2026-08-28');
  });

  it('数値ミリ秒・Date でも読む（読む側は緩く）', () => {
    const ms = Date.UTC(2026, 7, 28, 3, 0, 0);
    expect(resolveScheduleDate({ dueAt: ms })).toBe('2026-08-28');
    expect(resolveScheduleDate({ dueAt: new Date(ms) })).toBe('2026-08-28');
  });

  it('JST の暦日で返す（UTC 直読みだと深夜〜早朝に前日へずれる）', () => {
    expect(resolveScheduleDate({ dueAt: ts(JST_EARLY_MORNING) })).toBe('2026-08-28');
  });

  it('`date` があれば `dueAt` より優先する（自分の書いた形を先に見る）', () => {
    expect(resolveScheduleDate({ date: '2026-01-01', dueAt: ts(Date.UTC(2026, 7, 28)) })).toBe('2026-01-01');
  });

  it('`YYYY-MM-DD` でない `date` は使わず `dueAt` に落とす（別形式を素通しにしない）', () => {
    expect(resolveScheduleDate({ date: '2026/08/28', dueAt: ts(Date.UTC(2026, 7, 28, 3)) })).toBe('2026-08-28');
    expect(resolveScheduleDate({ date: 'あした' })).toBeNull();
  });

  // ⚠️ ここが本丸。`''` を返すと画面で `'' < today` が真になり、**黙って「過去」に混ざる**
  it('どちらも読めなければ null（空文字を返さない）', () => {
    for (const d of [{}, { date: '' }, { date: 20260828 }, { dueAt: 'あした' }, { dueAt: null }, null, undefined]) {
      expect(resolveScheduleDate(d as Record<string, unknown> | null)).toBeNull();
    }
  });

  it('「日付が読めない」と「別の日だった」を混ぜない（P154-PM2 と同じ切り分け）', () => {
    // 読めた結果が過去の日付なのは**正しい絞り込み**。読めなかったのは欠陥で、別勘定
    expect(resolveScheduleDate({ date: '2020-01-01' })).toBe('2020-01-01');
    expect(resolveScheduleDate({ note: 'メモだけ' })).toBeNull();
  });
});
