/**
 * Firestore から読んだ値を、期待する型でだけ受け取る guard（P166）。
 *
 * ## なぜ独立したファイルにしたか
 * `functions/src` の `.data()` 34 件を分類したところ、2 つの形に割れていた:
 *   - **写像を通す形**: `sales-sync.ts` は `num()` / `str()` を自前に持ち、
 *     金額・区分・名前を型で選り分けてから書いていた（＝正しい形）。
 *   - **生のまま項目を取る形**: `lib/workspaces.ts` / `lib/stats.ts` などは
 *     `(data.totalSales as number) ?? 0` で、`as` は実行時に何も検証しないため
 *     **文字列の金額がそのまま number として下流へ流れる**。
 * ＝ 同じリポの中に「守っている場所」と「守っていない場所」が並んでいて、
 * その差が**どちらが正しいかではなく、たまたまどちらを書いたか**で決まっていた。
 *
 * 🔴 `as` は「そう読める」ではなく「そう読むことにする」宣言でしかない。
 * `?? 0` が守るのは null / undefined だけで、**型違いは素通りする**。
 * 実際に `salesAmount: '8000'` を混ぜると日次サマリは `0 + 12000 + '8000'` で
 * **`¥120008000`** を送っていた（P166 で実測）。落ちないので誰も気付かない。
 *
 * ⚠️ **読めないものを推測で救わない。** `'8000'` を 8000 と読み替えると、
 * 「桁区切り入りの文字列」「全角数字」「通貨記号つき」まで芋づるで解釈が要る。
 * ここでは既定へ倒し、**書き手を直す**（型が揃っていないと範囲クエリも並べ替えも成立しない）。
 */

/** number のときだけ受ける（NaN / Infinity は既定へ倒す）。それ以外は 0 */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** string のときだけ受ける。それ以外は null（空文字はそのまま通す＝呼び出し側の判断） */
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** boolean のときだけ受ける。それ以外は null（「未設定」と `false` を混ぜない） */
export function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
