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

export interface StoreAccessState extends StoreAccess {
  /** 判定に必要な読み取りが欠けている（＝「店舗が無い」と言い切れない）・Day109 */
  unresolved: boolean;
}

/**
 * 読み取り失敗（`null`）を「店舗が無い」と同一視しない版（Day109）。
 *
 * 旧実装は所有・所属の両方が失敗したとき素通りで hasStore=false にしていた。その結果、
 * 通信断でアカウント画面の店舗運営セクションが丸ごと消え、しかも
 * **「＋ 店舗を登録すると解放」**（＝すでに店舗があるのに自分の店を作れという誘導）が出ていた。
 * 片方だけ失敗した場合も同様で、所属クエリが落ちるとキャストは店舗 UI を失う。
 *
 * 方針: 判明している側だけで**肯定に確定できるならする**（1件でもあれば hasStore は覆らない）。
 * 否定（hasStore=false）と isOwner=false は、その根拠となる読み取りが揃っているときだけ確定する。
 */
export function resolveStoreAccessState(
  ownedShopIds: readonly string[] | null,
  membershipShopIds: readonly string[] | null,
): StoreAccessState {
  const owned = ownedShopIds ?? [];
  const memberships = membershipShopIds ?? [];
  const base = resolveStoreAccess(owned, memberships);
  // isOwner=false は所有クエリが読めたときだけ確定（読めていなければ登録 CTA を出してはいけない）
  const ownerUnknown = ownedShopIds === null;
  if (base.hasStore) return { hasStore: true, isOwner: base.isOwner, unresolved: ownerUnknown };
  // 否定は両方揃って初めて言える
  const unresolved = ownerUnknown || membershipShopIds === null;
  return { hasStore: false, isOwner: false, unresolved };
}
