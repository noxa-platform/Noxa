// 予定 1 件の「日付」を決める（P156）。画面から切り出して純関数にした——
// **金額や日付の決定がコンポーネントの中にあるとテストが書けない**（P153-PM23 と同じ理由）。
//
// ## なぜ読み替えが要るか
// `personal_reminders/{uid}/items` は **Web と iOS が共有**しているが、書き方が違う:
//   - Web（`ScheduleClient`）… `date: "YYYY-MM-DD"`（文字列）
//   - iOS（AI 経由の自動生成）… `dueAt`（Firestore の `Timestamp`）
// 旧実装は `d.date` しか見ておらず、iOS の予定は `date: ''` になっていた。
// 画面は `date >= today` で「今後」を絞るので **`''` は必ず偽 → 全部「過去」へ落ち、
// 日付欄が空のまま並ぶ**。消えてはいないが**嘘の場所に出ていた**。
//
// ⚠️ 書き込み形の統一（`status` / `workspaceID` / `dismissed`）は人間判断待ち。
//    ここは**読み替えだけ**で、書く側は一切変えない。
// ⚠️ **どちらも読めないときは `null` を返す。** 空文字を返すと呼び出し側で
//    「過去」に混ざる（「別の日だった」と「日付が読めない」は別のこと・P154-PM2）。
import { toMillis, jstCalendarDate } from '@/lib/datetime';

/** `YYYY-MM-DD` の形か（他アプリが別形式を入れていても素通しにしない） */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveScheduleDate(d: Record<string, unknown> | undefined | null): string | null {
  if (!d) return null;
  const raw = typeof d.date === 'string' ? d.date.trim() : '';
  if (DATE_PATTERN.test(raw)) return raw;
  // iOS の `dueAt`。`dueDate` は型定義側の呼び名で実データがあるとは限らないが、
  // **読む側は緩く**取る（P153-PM15「fail-closed の前に網を広げる」と同じ）
  const ms = toMillis(d.dueAt ?? d.dueDate);
  if (ms === null) return null;
  // JST の暦日にする（UTC 直読みだと深夜〜早朝に前日へずれる）
  return jstCalendarDate(new Date(ms)).date;
}
