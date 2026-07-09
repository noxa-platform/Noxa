// Day13: 目標の月別履歴（過去月は当時の目標で達成率計算）のテスト。
import { describe, it, expect } from 'vitest';
import { computeGoalHistory } from '../../src/lib/goals/history';

const MONTHS = [
  { ym: '2026-05', label: '5月' },
  { ym: '2026-06', label: '6月' },
  { ym: '2026-07', label: '7月' },
];

describe('computeGoalHistory', () => {
  it('過去月は「当時の目標」で達成率を計算する（現在の目標変更に引きずられない）', () => {
    const h = computeGoalHistory(
      MONTHS,
      { '2026-05': 500_000, '2026-06': 800_000, '2026-07': 300_000 },
      { '2026-05': 500_000, '2026-06': 1_000_000 }, // 6月から目標を上げた
      2_000_000, // 現在（7月）はさらに上げた
      '2026-07',
    );
    expect(h[0]).toMatchObject({ ym: '2026-05', rate: 100, estimated: false }); // 50万/50万
    expect(h[1]).toMatchObject({ ym: '2026-06', rate: 80, estimated: false });  // 80万/100万
    expect(h[2]).toMatchObject({ ym: '2026-07', rate: 15, current: true });     // 30万/200万
  });

  it('当時の目標が未記録の過去月は現在の目標で換算し estimated を立てる', () => {
    const h = computeGoalHistory(MONTHS, { '2026-05': 500_000 }, {}, 1_000_000, '2026-07');
    expect(h[0]).toMatchObject({ rate: 50, estimated: true });
    expect(h[2].estimated).toBe(false); // 当月は現在の目標そのもの＝概算ではない
  });

  it('目標ゼロ（未設定）は 0% で落ちない・実績なし月は 0%', () => {
    const h = computeGoalHistory(MONTHS, {}, {}, 0, '2026-07');
    expect(h.map((x) => x.rate)).toEqual([0, 0, 0]);
  });

  it('月別目標に 0 以下が紛れても無視して現在の目標で換算する', () => {
    const h = computeGoalHistory(MONTHS, { '2026-05': 100_000 }, { '2026-05': 0 }, 200_000, '2026-07');
    expect(h[0]).toMatchObject({ rate: 50, estimated: true });
  });
});
