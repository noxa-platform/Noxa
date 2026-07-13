/**
 * 目標画面の月バケット（純ロジック）。
 *
 * 売上は businessDayKey（JST 6時切替の営業日）で dayKey が振られるため、
 * 目標の「今月」「直近6ヶ月」も同じ営業月基準に揃える。暦月で判定すると、
 * 月初の深夜 0〜6 時に立てた売上が前営業月へ入る一方で「今月」は新月になり、
 * 遅番の実績が当月に出ず達成率が早期に 0% へ落ちる（規約ズレ）。
 */
import { businessMonthKey } from '@/lib/datetime';

/** 営業月基準の当月キー（YYYY-MM）。 */
export function currentBusinessYm(now: Date = new Date()): string {
  return businessMonthKey(now);
}

/**
 * 営業月基準で当月を末尾に置いた直近6ヶ月（古い順）。
 * アンカーを businessMonthKey にすることで、月初深夜でも当月が正しく末尾に来る。
 * 各月の合成日（1日 0:00）は月内なので暦の年月表記で確定してよい（再度の営業日補正は不要）。
 */
export function lastSixMonths(now: Date = new Date()): { ym: string; label: string }[] {
  const [y, m] = currentBusinessYm(now).split('-').map(Number);
  const out: { ym: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push({
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${d.getMonth() + 1}月`,
    });
  }
  return out;
}
