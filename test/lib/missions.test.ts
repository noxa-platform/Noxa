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

describe('別リポとの契約（yorulog-ios が非 optional でデコードする）', () => {
  // 🔴 iOS は `/api/missions` の `category` を **非 optional** でデコードする。
  // 知らない値が 1 つ混ざると **一覧そのものがデコードに失敗する**（該当 1 件が消えるのではない）。
  // ⇒ **増減とも赤にして、変更前に yorulog へ連絡する手順を強制する。**
  // ⚠️ この判定は **Web だけを見ていても正しさが決まらない**（相手のデコーダが根拠）。
  //   相手が optional に変えたらここは緩められるが、**それは向こうからの連絡でしか分からない**。
  it('category の値集合は固定（増やすときも減らすときも先に iOS へ連絡）', () => {
    expect([...new Set(MISSIONS.map((m) => m.category))].sort()).toEqual(['data', 'profile', 'referral']);
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
