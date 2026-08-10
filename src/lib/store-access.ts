/**
 * 「店舗運営モジュールを出してよいか」の単一判定（純関数）。
 *
 * 旧実装は `shop_shops.ownerUid == uid`（＝オーナー）だけを見ていた。招待で参加した
 * メンバー（cast / manager / accounting）の所属は `account_users/{uid}/memberships/{shopId}`
 * にしか無いため、参加直後のキャストにはダッシュボードの店舗運営セクションが 1 つも
 * 描画されず、しかも「＋ 店舗を登録すると解放」と表示されていた（＝参加済みなのに
 * 自分の店を作れという誘導）。サイドバーは `hidden md:flex` でスマホには出ないので、
 * 実機（キャストはほぼスマホ）では **勤怠(打刻) / POS / 給与への到達手段がゼロ**になる。
 * Day104 の「API と rules が正しくても画面遷移で機能が到達不能になる」と同型。
 *
 * 判定を 1 か所に置き、オーナー限定に戻したら壊れることをテストで固定する。
 */
export interface StoreAccess {
  /** 店舗（オーナー or 所属）に到達できるか＝店舗運営モジュールを描画するか */
  hasStore: boolean;
  /** 自分がオーナーの店舗を 1 つ以上持つか（店舗登録 CTA の要否判定に使う） */
  isOwner: boolean;
}

export function resolveStoreAccess(
  ownedShopIds: readonly string[],
  membershipShopIds: readonly string[],
): StoreAccess {
  const isOwner = ownedShopIds.length > 0;
  return { hasStore: isOwner || membershipShopIds.length > 0, isOwner };
}
