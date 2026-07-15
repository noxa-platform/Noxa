/**
 * 在庫数・ボトルキープ残量の増減（純ロジック）。
 *
 * Firestore transaction 内で「最新値 + delta」に適用するための純関数。
 * 旧実装は updateDoc にローカル state 基準の `qty + delta` を書いていたため、
 * 2端末が同時に増減すると片方の更新が消える（lost update）＝在庫数・発注アラートが狂う。
 * tx でサーバの最新値に対して本関数を適用することで原子化する（本コードベースの
 * runTransaction 規約＝会計/席回しと同じ）。
 */

/** 在庫数の増減。0 未満にはしない。非数値は 0 に丸めて事故らせない。 */
export function nextStockQty(current: number, delta: number): number {
  const c = Number.isFinite(current) ? current : 0;
  const d = Number.isFinite(delta) ? delta : 0;
  return Math.max(0, c + d);
}

/** 残量文字列("65%" 等)→ 0-100 の数値。数字を含まなければ null（＝未記録）。 */
export function parseRemainingPct(remaining: unknown): number | null {
  const s = remaining == null ? '' : String(remaining);
  const m = s.match(/\d+(\.\d+)?/);
  return m ? Math.max(0, Math.min(100, Number(m[0]))) : null;
}

/** ボトルキープ残量の増減(±10% 等)。未記録(null)は 100% から開始。0-100 でクランプ。 */
export function nextRemainingPct(current: number | null, delta: number): number {
  const base = current ?? 100;
  const d = Number.isFinite(delta) ? delta : 0;
  return Math.max(0, Math.min(100, base + d));
}
