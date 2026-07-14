/**
 * 勤怠シフトの日跨ぎ解決（純ロジック）。
 *
 * 夜職は 20〜翌5時のように日付をまたぐ勤務が常態。退勤時刻を出勤と同じ暦日で
 * 作ると（出勤23:00・退勤05:00 のように）end<start になり、給与集計で
 * 「en>st でない＝加算されず」「en が有る＝退勤忘れ扱いにもならず」丸ごと消えて
 * 無給になる事故が起きる。end が start 以下なら翌日扱いにして必ず start より後にする。
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 出勤(startMs)に対し、同暦日で作った退勤候補(endBaseMs)が start 以下なら
 * 翌日（+24h）に送って必ず start より後にする。start より後ならそのまま。
 */
export function resolveOvernightEndMs(startMs: number, endBaseMs: number): number {
  return endBaseMs <= startMs ? endBaseMs + DAY_MS : endBaseMs;
}
