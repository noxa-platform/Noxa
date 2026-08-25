// 「見込み給与」の計算（キャスト本人が自分の画面で見る額）。P153-PM23 で純関数へ切り出した。
//
// なぜ切り出したか: **金額の計算が画面コンポーネントの中にあり、テストが書けなかった**。
// サーバの確定計算（`/api/team/finalize-payroll`）はテスト済みだったのに、
// 本人が毎日見る「見込み」は素通しだった。
//
// ⚠️ **時間に入らなかった勤務を黙って落とさない**。退勤打刻の無い勤務や
// `end <= start` の壊れた勤務は時間に計上できないが、**件数を返して画面に出す**。
// 旧実装は何も言わずに飛ばしており、オーナー側の確定画面には「打刻漏れ n 件」の警告が
// 出るのに、**本人が見る見込みだけ黙って少ない額**になっていた。
// 金額が絡む欠落は、欠落そのものより**気づく手がかりが無いこと**が問題。
import { toMillis } from '@/lib/datetime';

export interface DraftShiftInput {
  /** "YYYY-MM-DD"。当月の判定に使う */
  date?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}

export interface DraftPayroll {
  /** 給与時間に計上できた分数 */
  minutes: number;
  /** 出勤はあるのに閉じられていない/壊れている勤務の件数（時間に入っていない） */
  staleOpens: number;
  hours: number;
  /** 基本給（円・四捨五入） */
  base: number;
}

/**
 * 当月の勤務から見込みの基本給を出す。
 *
 * ⚠️ 出勤打刻すら無い行は**数えない**（「勤務の記録が無い」だけで、打刻漏れではない）。
 * 出勤はあるのに閉じられていない行だけを `staleOpens` に数える
 * （サーバの `finalize-payroll` と同じ数え方）。
 */
export function computeDraftPayroll(
  shifts: DraftShiftInput[],
  yearMonth: string,
  hourlyWage: number,
): DraftPayroll {
  let minutes = 0;
  let staleOpens = 0;
  for (const sh of shifts) {
    const date = typeof sh.date === 'string' ? sh.date : '';
    if (!date.startsWith(yearMonth)) continue;
    const s = toMillis(sh.startAt);
    const e = toMillis(sh.endAt);
    if (s !== null && e !== null && e > s) {
      minutes += (e - s) / 60000;
      continue;
    }
    if (s !== null) staleOpens += 1;
  }
  const wage = Number.isFinite(hourlyWage) && hourlyWage > 0 ? hourlyWage : 0;
  const hours = minutes / 60;
  return { minutes, staleOpens, hours, base: Math.round(hours * wage) };
}
