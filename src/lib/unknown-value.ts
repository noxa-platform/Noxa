// 「知らない値を丸めた結果で上書きしない」ための小さな判定（P157）。
//
// ## 背景
// 画面は保存値を読むときに、知らない値を既定へ**丸める**ことがある
// （例: `status: isReqStatus(v.status) ? v.status : 'waiting'`）。表示のためには要る。
// ⚠️ **問題はその丸めた値を書き戻すとき。** 別のアプリ（iOS / nomishugy / 将来の Web）が
// 書いた新しい状態が、こちらの既定値で**黙って上書きされて消える**。
// 記録エンジンの §1.6「未知は拒否せず保持する」は読みだけの話ではなく、**書き込みの形**の話でもある。
//
// 💡 yorulog が iOS 側で `LogType` / `NominationType` / `ReminderKind` の
// 「未知値を丸めてから書き戻す」を潰し、**未知値をそのまま書き戻す**ようにした（2026-08-28）。
// **片側だけ直しても、もう片側が丸めれば台無しになる**ので Web 側も揃える。

/**
 * 保存されている生の値を、こちらが上書きしてよいか。
 *
 * - **未設定**（`undefined` / `null` / 空文字）… まだ誰も書いていないので**書いてよい**
 * - **知っている値** … 自分の語彙なので**書いてよい**
 * - **知らない値** … 他の書き手のもの。**書かない**（呼び出し側で断るか、その項目を patch から外す）
 */
export function isOverwritable(raw: unknown, known: (v: unknown) => boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return true;
  return known(raw);
}

/**
 * 上書きを見送ったことの説明。
 * ⚠️ **黙って何も起きないのが一番まずい**（押しても変わらないだけでは、現場は
 * 「壊れている」のか「効いている」のか判らない）。実際の値を見せて、次の行動が判る文にする。
 */
export function describeUnknownValue(raw: unknown): string {
  const shown = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return `このアプリが知らない状態（${shown}）のため、上書きしませんでした。別のアプリで更新された可能性があります。`;
}

/**
 * 保存値が「こちらの知らない値」か（P160）。表示の判断に使う。
 *
 * ⚠️ `isOverwritable` とは**別の問い**。あちらは「書いてよいか」で、
 * **未設定は書いてよい**（まだ誰も書いていないので）。こちらは「そのまま出してよいか」で、
 * **未設定は既定の見え方でよい**（値が無いだけ）。**知らない値が入っているときだけ**、
 * 丸めた表示が**嘘**になる。
 */
export function isUnknownValue(raw: unknown, known: (v: unknown) => boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return false;
  return !known(raw);
}

/**
 * 知らない値をそのまま見せるときの表示（P160）。
 *
 * ⚠️ **丸めた既定のラベルで出さない。** `status: 'arrived'` を「待機」と表示すると、
 * 画面は**別のアプリが進めた状態を、まだ待機中だと言い切る**。
 * P157 で書き込みは守ったが、**表示は丸めたままだった**——「切ったことを言わずに
 * 全体の顔で出す」の表示版で、書き込みより先に人の目に入る。
 */
export function unknownValueLabel(raw: unknown): string {
  const shown = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return `不明（${shown}）`;
}
