import { describe, it, expect } from 'vitest';
import { inviteExpiresAtMs, isInviteExpired } from '../../src/lib/invite-expiry';

// 招待コードの失効判定（Day104）。
// 受諾 API（api/team/redeem-invite の toMs）と同じ正規化・同じ基準であることを固定する。
// 画面が「使える」と言っているのに相手側だけ 410 で弾かれる、というズレを防ぐのが目的。

const NOW = 1_800_000_000_000;

describe('inviteExpiresAtMs', () => {
  it('Firestore Timestamp（toMillis）を ms に正規化', () => {
    expect(inviteExpiresAtMs({ toMillis: () => 1234 })).toBe(1234);
  });

  it('シリアライズされた {seconds} 形も受ける（秒→ms）', () => {
    expect(inviteExpiresAtMs({ seconds: 1700 })).toBe(1_700_000);
  });

  it('数値はそのまま ms として扱う', () => {
    expect(inviteExpiresAtMs(NOW)).toBe(NOW);
  });

  it('不明な形・欠落は 0（＝失効扱い）', () => {
    expect(inviteExpiresAtMs(undefined)).toBe(0);
    expect(inviteExpiresAtMs(null)).toBe(0);
    expect(inviteExpiresAtMs('2026-08-09')).toBe(0);
    expect(inviteExpiresAtMs({})).toBe(0);
  });
});

describe('isInviteExpired', () => {
  it('期限が未来なら未失効', () => {
    expect(isInviteExpired({ toMillis: () => NOW + 1 }, NOW)).toBe(false);
  });

  it('ちょうど同時刻は失効（受諾 API の `< now` と同じ向き）', () => {
    expect(isInviteExpired({ toMillis: () => NOW }, NOW)).toBe(false);
    expect(isInviteExpired({ toMillis: () => NOW - 1 }, NOW)).toBe(true);
  });

  it('expiresAt が無い doc は失効扱い（API 側も 410 で弾く）', () => {
    expect(isInviteExpired(undefined, NOW)).toBe(true);
  });
});
