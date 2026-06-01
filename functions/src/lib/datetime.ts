/**
 * 日付・タイムスタンプユーティリティ（JST 基準）。
 *
 * Cloud Functions の v2 scheduled は timeZone を 'Asia/Tokyo' に
 * 指定して実行するが、内部処理でも JST で日付計算するための補助。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 現在時刻を JST の `Date` として返す（UTC 内部表現に +9h オフセットを足したもの） */
export function nowJst(): Date {
  return new Date(Date.now() + JST_OFFSET_MS);
}

/** Date を JST の 'YYYY-MM-DD' に整形 */
export function toJstDateString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' または 'MM-DD' から MM-DD だけ抜き出す */
export function extractMonthDay(birthday: string | null | undefined): string | null {
  if (!birthday) return null;
  // 'YYYY-MM-DD' → 'MM-DD'
  if (birthday.length === 10) return birthday.slice(5);
  // 'MM-DD' そのまま
  if (birthday.length === 5) return birthday;
  return null;
}

/** N 日後の JST 日付 'MM-DD' を返す */
export function jstMonthDayDaysAhead(daysAhead: number): string {
  const now = nowJst();
  const target = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

/** 今日の JST 0:00 (UTC ベース Date) */
export function jstStartOfToday(): Date {
  const today = toJstDateString(new Date());
  // 'YYYY-MM-DD' → JST 0:00 = UTC 前日 15:00
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

/** 昨日の JST 0:00 (UTC ベース Date) */
export function jstStartOfYesterday(): Date {
  const start = jstStartOfToday();
  return new Date(start.getTime() - 24 * 60 * 60 * 1000);
}

/** N 日前の JST 0:00 (UTC ベース Date) */
export function jstDaysAgo(days: number): Date {
  const start = jstStartOfToday();
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}
