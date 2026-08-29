import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/strip-comments';
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

describe('別リポとの契約（yorulog-ios のデコーダが根拠）', () => {
  // 🔴 **P162-PM2 では `category` の値集合を固定していたが、根拠が失効していた**（P162-PM3 で訂正）。
  //   iOS は P131 で `MissionCategory` に独自の `init(from:)` を入れており、
  //   未知の値は `.unknown(raw)` になって **throw しない**（`MissionService.swift:19-50`。
  //   `ForwardCompatEnumsP131Tests.testUnknownCategoryDoesNotDropTheWholeMissionList` が固定）。
  //   ⇒ **分類を足しても一覧は落ちない。** 失効した理由で締めるのをやめる。
  // 🔴 **落ちる引き金は `MissionItem` の非 optional な 6 フィールド**。
  //   欠けるか型が変わると **一覧ごと throw**（該当 1 件が消えるのではない）。
  //   ⚠️ 出所は `src/app/api/missions/route.ts` の `items` なので、**そこを走査して固定する**。
  //   ⚠️ この判定は **Web だけを見ていても正しさが決まらない**（相手のデコーダが根拠）。
  //   相手が optional に変えたら緩められるが、**それは向こうからの連絡でしか分からない**。
  const REQUIRED = ['id', 'title', 'description', 'rewardCredits', 'order', 'claimed'];

  it('/api/missions の 1 件は非 optional な 6 キーを必ず含む（欠けると iOS は一覧ごと落ちる）', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'src/app/api/missions/route.ts'), 'utf8'));
    const items = src.match(/const items = MISSIONS\.map\(\(m\) => \(\{([\s\S]*?)\}\)\)/);
    expect(items).not.toBeNull();
    const keys = [...items![1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    for (const k of REQUIRED) expect(keys).toContain(k);
  });

  it('MISSIONS の全件が 6 キーの値を持つ（null / undefined を混ぜない）', () => {
    for (const m of MISSIONS) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.title).toBe('string');
      expect(typeof m.description).toBe('string');
      expect(typeof m.rewardCredits).toBe('number');
      expect(typeof m.order).toBe('number');
    }
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
