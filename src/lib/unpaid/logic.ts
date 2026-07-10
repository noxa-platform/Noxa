/**
 * 売掛管理の純ロジック（UnpaidClient から分離・Day24）。
 *
 * 状態遷移・回収額の計算は金銭表示に直結するため、UI から切り離して
 * ユニットテストで固定する（Day23 で修正した「回収済から戻すと残高¥0の
 * 未回収になる」不整合の再発防止）。
 */

export type UnpaidStatus = '未回収' | '一部回収' | '回収済';

export const UNPAID_STATUS_OPTIONS: UnpaidStatus[] = ['未回収', '一部回収', '回収済'];

export type UnpaidLike = {
  amount: number;     // 売掛額
  paidAmount: number; // 回収済額
  status: UnpaidStatus;
  due?: string | null; // YYYY-MM-DD 期日
};

/** 残高（売掛額 − 回収済）。負にならないよう 0 でクランプ */
export const balanceOf = (r: Pick<UnpaidLike, 'amount' | 'paidAmount'>) =>
  Math.max(0, r.amount - r.paidAmount);

/**
 * ステータス手動変更時の書込パッチ。
 * - →回収済: 回収済額を売掛額に揃える
 * - 回収済→他: 誤操作の取り消し＝回収済額をリセットして債権を再表示
 *   （据え置くと「未回収なのに残高¥0」で合計・ランキングからも消える。
 *    回収実績は回収記録で入れ直す）
 */
export function statusChangePatch(
  current: Pick<UnpaidLike, 'amount' | 'status'>,
  next: UnpaidStatus,
): { status: UnpaidStatus; paidAmount?: number } {
  const patch: { status: UnpaidStatus; paidAmount?: number } = { status: next };
  if (next === '回収済') patch.paidAmount = current.amount;
  else if (current.status === '回収済') patch.paidAmount = 0;
  return patch;
}

/**
 * 一部回収の書込パッチ。無効な回収額（NaN/0以下）は null。
 * 過回収は売掛額でクランプし、満額到達で自動的に回収済へ。
 */
export function collectPatch(
  current: Pick<UnpaidLike, 'amount' | 'paidAmount'>,
  add: number,
): { paidAmount: number; status: UnpaidStatus } | null {
  if (!Number.isFinite(add) || add <= 0) return null;
  const nextPaid = Math.min(current.amount, current.paidAmount + add);
  return { paidAmount: nextPaid, status: nextPaid >= current.amount ? '回収済' : '一部回収' };
}

/** 期日超過か（回収済は除く。YYYY-MM-DD の文字列比較・当日は超過扱いにしない） */
export function isOverdue(r: Pick<UnpaidLike, 'status' | 'due'>, todayKey: string): boolean {
  return r.status !== '回収済' && !!r.due && r.due < todayKey;
}
