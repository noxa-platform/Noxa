import { describe, expect, it } from 'vitest';
import { MISSIONS, MISSION_IDS, REFERRAL_BONUS, getMission, totalRewardCredits } from '../../src/lib/missions';

// ミッション定義の不変条件——クレジット配布（reward_missions）の前提規約（Day27）

describe('MISSIONS の不変条件', () => {
  it('id は一意・order は昇順で重複なし', () => {
    expect(new Set(MISSION_IDS).size).toBe(MISSIONS.length);
    const orders = MISSIONS.map((m) => m.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
  });
  it('報酬は正の整数', () => {
    for (const m of MISSIONS) {
      expect(Number.isInteger(m.rewardCredits), m.id).toBe(true);
      expect(m.rewardCredits, m.id).toBeGreaterThan(0);
    }
  });
  it('totalRewardCredits は全報酬の合計と一致', () => {
    expect(totalRewardCredits()).toBe(MISSIONS.reduce((a, m) => a + m.rewardCredits, 0));
  });
  it('getMission は既知 id を返し、未知 id は undefined', () => {
    expect(getMission('first_customer')?.rewardCredits).toBe(5);
    expect(getMission('nope')).toBeUndefined();
  });
});

describe('REFERRAL_BONUS とミッション定義の整合', () => {
  it('招待者ボーナス = invite_first_friend の報酬', () => {
    expect(REFERRAL_BONUS.referrer).toBe(getMission('invite_first_friend')!.rewardCredits);
  });
  it('被招待者ボーナス = accept_referral の報酬', () => {
    expect(REFERRAL_BONUS.referee).toBe(getMission('accept_referral')!.rewardCredits);
  });
});
