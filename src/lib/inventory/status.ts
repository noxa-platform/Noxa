/**
 * 在庫・ボトルキープの状態判定（純ロジック）。
 * UI（InventoryClient）から表示ロジックを分離し、境界をテストで固定する。
 */

export type StockStatus = 'ok' | 'low' | 'out';

/**
 * 在庫状態。qty<=0 は「切れ」、適正在庫(par)を下回れば「少ない」、それ以外「十分」。
 * par<=0（発注点未設定）は low を判定しない＝out のみ（不要な発注アラートを出さない）。
 */
export function stockStatus(qty: number, par: number): StockStatus {
  if (qty <= 0) return 'out';
  if (par > 0 && qty < par) return 'low';
  return 'ok';
}

export type ExpiryStatus = 'none' | 'near' | 'expired';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ボトルキープの期限状態。expiresAt は "YYYY-MM-DD"（空＝期限なし＝none）。
 * - 期限日の終わり（翌0時）を過ぎたら 'expired'（＝顧客ボトルの期限切れ。要処分/連絡）。
 * - 期限日当日を含み残り7日以内なら 'near'（期限間近）。
 * - それ以外は 'none'。
 *
 * 旧実装は `diff <= 7` のみで、期限切れ（diff<0）も「期限間近」に混ざり
 * 何ヶ月も切れたボトルが「7日以内」と誤表示されていた。expired を独立させて解消。
 */
export function keepExpiryStatus(expiresAt: string, nowMs: number): ExpiryStatus {
  if (!expiresAt) return 'none';
  const exp = new Date(`${expiresAt}T00:00:00`).getTime();
  if (!Number.isFinite(exp)) return 'none';
  // 期限日の翌0時を過ぎたら期限切れ（期限日当日はまだ有効）。
  if (nowMs >= exp + DAY_MS) return 'expired';
  // 未来7日以内（期限日当日＝残り0日を含む）。
  if (exp - nowMs <= 7 * DAY_MS) return 'near';
  return 'none';
}
