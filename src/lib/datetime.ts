const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 営業日キー（夜職基準・JST）。深夜6時より前は前日扱い。
 * 売上の書き込み側(POS)と読み取り側(売上集計)で同一ロジックを使うため一本化（誤集計防止）。
 *
 * JST 実時刻へ +9h 補正してから 6 時境界・暦日を取る（すぐ下の jstCalendarDate と同方式に統一）。
 * 旧実装は端末ローカル時刻の getHours/getDate に依存しており、端末TZが非JSTの利用や
 * サーバ(UTC=Vercel)から呼ぶと 6 時境界が JST からズレ、売上が誤った営業日に付く恐れがあった。
 * JST 端末で `new Date()` / Firestore Timestamp を渡す通常経路では結果は不変（no-op）。
 */
export function businessDayKey(d: Date = new Date()): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  if (j.getUTCHours() < 6) j.setUTCDate(j.getUTCDate() - 1);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}-${String(j.getUTCDate()).padStart(2, '0')}`;
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
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return { date: j.toISOString().slice(0, 10), weekday: j.getUTCDay() };
}

/**
 * JST 暦日「その日 1 日分」の絶対時刻ウィンドウ [start, end)（ISO Z 文字列）。
 * start = JST その日の 00:00、end = 翌 JST 00:00。
 * サーバ(UTC=Vercel)で `new Date(y, m, d)` を使うと UTC 暦日の窓になり JST 早朝帯で
 * 前日/翌朝へズレるため、JST 固定でウィンドウを組む用途に使う（例: カレンダーの今日分取得）。
 */
export function jstDayWindow(d: Date = new Date()): { startIso: string; endIso: string } {
  const { date } = jstCalendarDate(d);
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
