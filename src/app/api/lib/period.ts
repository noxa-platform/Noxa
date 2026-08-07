// 対象年月（period）の受け取り共通ヘルパー（Day102 で finalize-payroll に導入 → Day103 で共通化）。
//
// 「不正な入力を 400 で弾かず、黙ってサーバの当月へフォールバックする」実装は、
// 頼んだ月と違う月を処理してしまう静かな事故になる（Day102 の給与確定の実バグ）。
// year / month を受け取る route はこのヘルパーを通し、null が返ったら 400 にする。

/**
 * 値が来ていれば整数＋範囲を検証して返し、不正なら null（＝呼び出し側で 400）。
 * 未指定（undefined）のときだけ fallback（サーバ既定月）を返す。
 */
export function pickPeriodPart(v: unknown, min: number, max: number, fallback: number): number | null {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
