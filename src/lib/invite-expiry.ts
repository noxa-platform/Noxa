// 店舗メンバー招待コードの失効判定（クライアント表示用）。
//
// 正本は受諾 API（api/team/redeem-invite）で、そこでは expiresAt を ms に正規化して
// `< Date.now()` なら 410 を返す。**expiresAt が欠けている doc も 0 扱い＝失効**として
// 弾かれるため、画面側も同じ基準で「期限切れ」と表示する（画面は使える風なのに
// 相手側だけ弾かれる、というズレを作らない）。

/** Timestamp / {seconds} / ms 数値 を ms に正規化する（不明な形は 0＝失効扱い）。 */
export function inviteExpiresAtMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
}

/** 招待コードが失効しているか（受諾 API と同じ基準）。 */
export function isInviteExpired(expiresAt: unknown, now: number = Date.now()): boolean {
  return inviteExpiresAtMs(expiresAt) < now;
}
