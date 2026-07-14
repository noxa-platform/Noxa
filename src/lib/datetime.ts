/**
 * 営業日キー（夜職基準）。深夜6時より前は前日扱い。
 * 売上の書き込み側(POS)と読み取り側(売上集計)で同一ロジックを使うため一本化（誤集計防止）。
 */
export function businessDayKey(d: Date = new Date()): string {
  const base = new Date(d);
  if (base.getHours() < 6) base.setDate(base.getDate() - 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

/** 営業日キーの年月（YYYY-MM）。月次集計用。 */
export function businessMonthKey(d: Date = new Date()): string {
  return businessDayKey(d).slice(0, 7);
}

/**
 * JST の暦日と曜日（営業日切替はしない純カレンダー日）。
 * サーバは UTC 動作のため +9h してから日付/曜日を取る。
 * 例: AI に「今日は◯/◯（◯曜）」と伝える際、`new Date().toISOString()` や
 * `getDay()` を直接使うと JST 00:00〜08:59 の間 UTC 前日になり相対日付がズレる。
 */
export function jstCalendarDate(d: Date = new Date()): { date: string; weekday: number } {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return { date: j.toISOString().slice(0, 10), weekday: j.getUTCDay() };
}
