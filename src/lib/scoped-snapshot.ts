/**
 * 「出所つきスナップショット」の共通判定（純関数・Day123）。
 *
 * Firestore の購読は `useEffect([shopId])` のように**出所（scope）が変わる**。ところが
 * `if (snap.exists()) setX(...)` とだけ書くと、**新しい出所に doc が無い場合や読み込みが
 * 終わるまでの間、前の出所の値がそのまま画面に残る**。
 *
 * 実害（Day123 で確認）:
 *   - 席回し: 店舗を切り替えても料金設定が前の店のままで、卓合計が**別店舗の料金**で出る。
 *   - 予約: 同型。しかも来店処理は伝票（`createInitialState(posCfg)`）を**永続化**するため、
 *     別店舗の料金で作った伝票が売上まで流れる（Day115 の「既定料金の伝票」と同型）。
 *
 * 値と一緒に「どの出所の値か」を持ち、出所が一致しないときは**既定に戻す**。
 * これは Day21 の「出所（uid）つきスナップショット」を店舗にも広げたもの。
 */

/** 出所つきの値。scope は uid / shopId など「これが変わったら別物」になる識別子 */
export interface ScopedSnapshot<T> {
  scope: string;
  value: T;
}

/**
 * 現在の出所に一致するときだけスナップショットの値を使い、そうでなければ既定を返す。
 * （未取得・出所違い・出所そのものが未確定 のいずれも既定）
 */
export function valueForScope<T>(
  snap: ScopedSnapshot<T> | null | undefined,
  scope: string | null | undefined,
  fallback: T,
): T {
  if (!snap || !scope) return fallback;
  return snap.scope === scope ? snap.value : fallback;
}

/**
 * 現在の出所に一致するエラーだけを返す。
 * 前の出所で起きた失敗を、切り替えた先の画面で出し続けない。
 */
export function errorForScope(
  snap: ScopedSnapshot<string | null> | null | undefined,
  scope: string | null | undefined,
): string | null {
  return valueForScope(snap, scope, null);
}
