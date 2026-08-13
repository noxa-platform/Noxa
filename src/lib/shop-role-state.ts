/**
 * 店舗ロールの状態解決（純ロジック・Day108）。
 *
 * `useShopRole` から切り出した判定。要点は **「role が無い」と「role を確認できなかった」を混ぜない**こと:
 *   - members/{uid} が存在しない → role=null（＝本当に権限が無い。UI は「オーナー専用です」でよい）
 *   - 取得が失敗した（通信断・オフライン復帰直後・一時的な権限エラー） → role=null だが `roleError` あり
 *     → UI が「オーナー専用です」と言い切ると、**店長/経理が権限を剥奪されたように見える**
 *       （売掛・リスク・給与確定の画面が丸ごと閉じ、原因も分からない）。
 *
 * 権限を広げる判定は一切しない（失敗時に許可へ倒すことはない）。
 */

/** members/{uid} の取得結果（shopId とペアで持ち、店舗切替時の取り違えを防ぐ） */
export type FetchedRole = {
  shopId: string;
  role: string | null;
  /** 取得自体が失敗したときの説明文（成功時は undefined） */
  error?: string;
};

export type ShopRoleState = {
  role: string | null;
  roleReady: boolean;
  roleError: string | null;
};

export function resolveShopRoleState(input: {
  loading: boolean;
  shopId: string | null;
  /** shop_shops/{shopId}.ownerUid == uid（オーナーは members 不在でも owner 扱い） */
  canManage: boolean;
  fetched: FetchedRole | null;
}): ShopRoleState {
  const { loading, shopId, canManage, fetched } = input;
  const matched = !!shopId && fetched?.shopId === shopId ? fetched : null;

  const role = canManage ? 'owner' : (matched ? matched.role : null);
  // ゲート判定を待たせないため、取得失敗でも ready にする（roleError で理由を伝える）
  const roleReady = !loading && (!shopId || canManage || matched !== null);
  // オーナー・店舗未選択では role 取得そのものを行わないので失敗もない
  const roleError = canManage || !shopId ? null : (matched?.error ?? null);

  return { role, roleReady, roleError };
}

/** 指定ロールのいずれかを持つか（オーナーは常に true）。取得失敗時は false のまま＝許可へ倒さない */
export function hasRole(state: { canManage: boolean; role: string | null }, roles: readonly string[]): boolean {
  if (state.canManage) return true;
  return state.role !== null && roles.includes(state.role);
}
