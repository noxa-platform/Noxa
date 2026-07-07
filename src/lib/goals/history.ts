/**
 * 目標の月別履歴（純ロジック・Day13）。
 *
 * 旧実装の問題: 目標は personal_goals/{uid}/items/current の1本で、
 * 目標額を変更すると過去月の達成率まで「現在の目標」で再計算され、
 * 過去のグラフが事実と変わってしまっていた。
 *
 * 新モデル: items/{YYYY-MM} に月別目標を保存（current は iOS/旧データ互換で温存し、
 * 当月保存時に両方へ書く）。過去月の達成率は「当時の目標」で計算し、
 * 当時の目標が未記録の月は現在の目標で換算した上で estimated=true を付ける（UI で注記）。
 */

export type GoalHistoryPoint = {
  ym: string;
  label: string;
  rate: number;
  current: boolean;
  /** 当時の月別目標が未記録＝現在の目標で換算した概算 */
  estimated: boolean;
};

export function computeGoalHistory(
  months: { ym: string; label: string }[],
  byMonth: Record<string, number>,
  goalsByYm: Record<string, number>,
  currentGoal: number,
  currentYm: string,
): GoalHistoryPoint[] {
  return months.map((m) => {
    const monthGoal = goalsByYm[m.ym];
    const hasOwnGoal = typeof monthGoal === 'number' && monthGoal > 0;
    const goal = hasOwnGoal ? monthGoal : currentGoal;
    const actual = byMonth[m.ym] ?? 0;
    return {
      ym: m.ym,
      label: m.label,
      rate: goal > 0 ? Math.round((actual / goal) * 100) : 0,
      current: m.ym === currentYm,
      estimated: !hasOwnGoal && m.ym !== currentYm,
    };
  });
}
