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

/**
 * Firestore の時刻値をミリ秒へ揃える（P166）。
 *
 * ## なぜ CF 側にも要るのか
 * これは `src/lib/datetime.ts` の `toMillis` と**同じ名前・同じ受け幅**の写し。
 * 本来 1 つにしたいが、`functions/` は依存も tsconfig も別（`main: lib/index.js` で
 * 単体デプロイされる）ため import できない。**写しであることを明記した上で幅を揃える。**
 *
 * 🔴 揃える理由は、揃っていなかったせいで実害が出たから。
 * P153-PM12 は「同じ値を書いても画面によって出たり『—』になったりする」を直すため
 * 9 つの写しを `src/lib/datetime.ts` へ集約したが、**その走査は `src/` だけを見ていた**。
 * 同じフィールド（`lastContactAt` / `nextActionDue`）を読む CF は
 * `(data.x as Timestamp) ?? null` のまま残り、読み手は `.toMillis()` を直接呼んでいた。
 * ＝ number で保存された値が来ると、画面のように「—」で済まず
 * **`.toMillis is not a function` で uid ごと throw** し、その利用者の通知が全部消える。
 *
 * ⚠️ **読み手は緩い側へ揃える。** 厳しくすると、いま number で保存されているデータの
 * 通知が一斉に止まる（`src/lib/datetime.ts` と同じ判断）。
 * ⚠️ **書き手は Timestamp で書くこと**——範囲クエリは型が揃っていないと一致しない。
 * ⚠️ 分からないものは **null**（0 に倒すと 1970-01-01 に化け、「30 日以上連絡なし」に
 * 永久に該当し続ける）。既定値は呼び出し側が決める。
 */
export function toMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v === 'string') {
    // ISO 8601 の形だけを受ける（「7」のような数字だけの文字列を年や日として解釈しない）
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v.trim())) return null;
    const ms = Date.parse(v.trim());
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v === 'object') {
    const o = v as { toMillis?: unknown; seconds?: unknown };
    if (typeof o.toMillis === 'function') {
      const ms = (o.toMillis as () => unknown)();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    }
    if (typeof o.seconds === 'number' && Number.isFinite(o.seconds)) return o.seconds * 1000;
  }
  return null;
}
