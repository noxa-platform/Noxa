import { describe, it, expect, beforeEach, vi } from 'vitest';

// grantBonusCredits（報酬付与）/ getAiCreditsRemaining（残数合算）/ getSubscriptionDoc（既定値）を
// Admin SDK モック＋フェイク Firestore で固定する（Day66）。reserve/refund は credits-refund.test.ts
// でカバー済みのため、残る money 系関数の実挙動をここで characterization する。
//
// 🔎 Day66 finding（要ユーザー判断・修正は保留）:
//   grantBonusCredits は「当月 used カウンタを Math.max(0, used - amount) で減算」する方式のため、
//   付与時点の used が付与額より少ないと超過分が**消失**する（used3 に 5cr 付与 → used0、2cr 消失）。
//   新規/低利用ユーザーがミッション報酬を早期受領すると報酬が蒸発し得る。超過分を purchasedCredits
//   （永続）に回す等は money 設計判断のため未修正。以下のテストは**現挙動を記録**する（意図的変更時に赤くなる）。

const mocks = vi.hoisted(() => ({ getAdminDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getAdminDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
    serverTimestamp: () => '__ST__',
    delete: () => '__DELETE__',
  },
}));

import { grantBonusCredits, getAiCreditsRemaining, getSubscriptionDoc } from '../../src/app/api/lib/credits';

type Slot = Record<string, unknown> | undefined;

/** account_ai_usage（月次 used）と account_subscriptions（purchased/plan）だけを持つ最小フェイク */
function makeDb(seed: { usage?: Record<string, unknown>; sub?: Record<string, unknown> } = {}) {
  const store: { usage: Slot; sub: Slot } = {
    usage: seed.usage ? { ...seed.usage } : undefined,
    sub: seed.sub ? { ...seed.sub } : undefined,
  };
  const slotOf = (path: string): 'usage' | 'sub' => {
    if (path.includes('account_ai_usage')) return 'usage';
    if (path.includes('account_subscriptions')) return 'sub';
    throw new Error(`unexpected path: ${path}`);
  };
  const mergeInto = (slot: 'usage' | 'sub', data: Record<string, unknown>) => {
    const cur: Record<string, unknown> = store[slot] ? { ...store[slot] } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && '__increment' in (v as Record<string, unknown>)) {
        cur[k] = (typeof cur[k] === 'number' ? (cur[k] as number) : 0) + (v as { __increment: number }).__increment;
      } else { cur[k] = v; }
    }
    store[slot] = cur;
  };
  const snapOf = (slot: 'usage' | 'sub') => ({ exists: store[slot] !== undefined, data: () => store[slot] });
  const makeRef = (path: string) => ({
    path,
    get: async () => snapOf(slotOf(path)),
    set: async (data: Record<string, unknown>) => mergeInto(slotOf(path), data),
  });
  const db = {
    doc: (path: string) => makeRef(path),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, data: Record<string, unknown>) => mergeInto(slotOf(ref.path), data),
    }),
  };
  return { db, store };
}
const count = (s: { usage: Slot }) => (s.usage as { count?: number } | undefined)?.count;

describe('grantBonusCredits（used カウンタ減算方式）', () => {
  beforeEach(() => mocks.getAdminDb.mockReset());

  it('used ≥ 付与額: used を付与額だけ減らす（実質 remaining を増やす）', async () => {
    const { db, store } = makeDb({ usage: { count: 30 } });
    mocks.getAdminDb.mockReturnValue(db);
    await grantBonusCredits('u1', 5);
    expect(count(store)).toBe(25);
  });

  it('小数付与は floor（30 に 2.7 付与 → 28）', async () => {
    const { db, store } = makeDb({ usage: { count: 30 } });
    mocks.getAdminDb.mockReturnValue(db);
    await grantBonusCredits('u1', 2.7);
    expect(count(store)).toBe(28);
  });

  it('amount ≤ 0 は no-op（DB を触らず即 return）', async () => {
    const { db, store } = makeDb({ usage: { count: 30 } });
    mocks.getAdminDb.mockReturnValue(db);
    await grantBonusCredits('u1', 0);
    await grantBonusCredits('u1', -5);
    expect(count(store)).toBe(30); // 変化なし
  });

  it('⚠️Day66 finding: used < 付与額だと超過分が消える（used3 に 5 付与 → 0・2cr 消失）', async () => {
    const { db, store } = makeDb({ usage: { count: 3 } });
    mocks.getAdminDb.mockReturnValue(db);
    await grantBonusCredits('u1', 5);
    // max(0, 3-5)=0。報酬 5cr のうち 3cr 分しか効かず 2cr 消失（現挙動の記録）
    expect(count(store)).toBe(0);
  });

  it('⚠️Day66 finding: 残満タン(used0)/doc 無しへの付与は完全に消える', async () => {
    const a = makeDb({ usage: { count: 0 } });
    mocks.getAdminDb.mockReturnValue(a.db);
    await grantBonusCredits('u1', 5);
    expect(count(a.store)).toBe(0); // 全消失

    const b = makeDb({}); // usage doc 無し
    mocks.getAdminDb.mockReturnValue(b.db);
    await grantBonusCredits('u1', 5);
    expect(count(b.store)).toBe(0); // count0 の doc を作るだけ＝全消失
  });
});

describe('getAiCreditsRemaining（月次残＋購入クレジット合算）', () => {
  beforeEach(() => mocks.getAdminDb.mockReset());

  // 2026-08-25: 無料の月次枠を廃止（free.maxAiCredits 50 → 0）。
  // free は「購入クレジットがある分だけ AI が使える」形になった。
  it('free: 月次枠ゼロ＝残は purchased のみ（購入済み残高は消えない）', async () => {
    const { db } = makeDb({ usage: { count: 10 }, sub: { purchasedCredits: 20 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await getAiCreditsRemaining('u1');
    expect(r).toEqual({ remaining: 20, total: 20, monthlyRemaining: 0, monthlyTotal: 0, purchasedCredits: 20 });
  });

  it('used が月次上限超: monthlyRemaining は 0 でクランプ（残は purchased のみ）', async () => {
    // 月次枠のクランプ機構そのものは有料プランで見る（free は上限 0 で自明に 0 になるため）
    const { db } = makeDb({ usage: { count: 1100 }, sub: { planTier: 'pro', purchasedCredits: 5 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await getAiCreditsRemaining('u1');
    expect(r).toEqual({ remaining: 5, total: 1005, monthlyRemaining: 0, monthlyTotal: 1000, purchasedCredits: 5 });
  });

  it('doc 無し: free は残 0（無料枠廃止後）', async () => {
    const { db } = makeDb({});
    mocks.getAdminDb.mockReturnValue(db);
    const r = await getAiCreditsRemaining('u1');
    expect(r).toEqual({ remaining: 0, total: 0, monthlyRemaining: 0, monthlyTotal: 0, purchasedCredits: 0 });
  });

  it('pro プラン: 上限 1000 が反映される', async () => {
    const { db } = makeDb({ usage: { count: 10 }, sub: { planTier: 'pro' } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await getAiCreditsRemaining('u1');
    expect(r.monthlyTotal).toBe(1000);
    expect(r.remaining).toBe(990);
  });

  it('purchasedCredits が負でも 0 にクランプ（残に負が混ざらない）', async () => {
    const { db } = makeDb({ sub: { purchasedCredits: -3 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await getAiCreditsRemaining('u1');
    expect(r.purchasedCredits).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe('getSubscriptionDoc（既定値とフォールバック）', () => {
  beforeEach(() => mocks.getAdminDb.mockReset());

  it('doc あり: 保存値を返す', async () => {
    const { db } = makeDb({ sub: { planTier: 'pro', status: 'active', seatBlocks: 2 } });
    mocks.getAdminDb.mockReturnValue(db);
    expect(await getSubscriptionDoc('u1')).toEqual({
      planTier: 'pro', status: 'active', seatBlocks: 2, currentPeriodEnd: null,
    });
  });

  it('doc 無し: null', async () => {
    const { db } = makeDb({});
    mocks.getAdminDb.mockReturnValue(db);
    expect(await getSubscriptionDoc('u1')).toBeNull();
  });

  it('空 doc: free/active/0 の既定値で埋める', async () => {
    const { db } = makeDb({ sub: {} });
    mocks.getAdminDb.mockReturnValue(db);
    expect(await getSubscriptionDoc('u1')).toEqual({
      planTier: 'free', status: 'active', seatBlocks: 0, currentPeriodEnd: null,
    });
  });
});
