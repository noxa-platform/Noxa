import { describe, it, expect, beforeEach, vi } from 'vitest';

// reserveAiCredit の消費内訳（月次/purchased）と、refundAiCredit の内訳対称払い戻し（Day39）を
// モジュール境界のモック＋フェイク Firestore で検証する。
// 核心の回帰: 月次不足で purchased から引いた予約を refund すると、買った永続クレジットが
// 月次（月末失効）に化ける過少払い戻し——内訳を渡せば purchased へ正しく戻ることを固定する。

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

import { reserveAiCredit, refundAiCredit } from '../../src/app/api/lib/credits';

type Slot = Record<string, unknown> | undefined;

/** account_ai_usage（月次 used）と account_subscriptions（purchased）だけを持つ最小フェイク */
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
  const makeRef = (path: string) => {
    const slot = slotOf(path);
    return {
      path,
      get: async () => snapOf(slot),
      set: async (data: Record<string, unknown>) => mergeInto(slot, data),
      update: async (data: Record<string, unknown>) => mergeInto(slot, data),
    };
  };
  const db = {
    doc: (path: string) => makeRef(path),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, data: Record<string, unknown>) => mergeInto(slotOf(ref.path), data),
      update: (ref: { path: string }, data: Record<string, unknown>) => mergeInto(slotOf(ref.path), data),
    }),
  };
  return { db, store };
}
const count = (s: { usage: Slot }) => (s.usage as { count?: number })?.count;
const purchased = (s: { sub: Slot }) => (s.sub as { purchasedCredits?: number })?.purchasedCredits;

describe('reserveAiCredit の消費内訳', () => {
  beforeEach(() => mocks.getAdminDb.mockReset());

  it('月次枠で賄える: 全額 monthly から消費（consumedPurchased=0）', async () => {
    // 無料枠廃止（free=0）後、月次枠の消費機構は有料プランで見る
    const { db, store } = makeDb({ sub: { planTier: 'pro' } }); // pro=1000・used0・purchased0
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 5);
    expect(r.ok).toBe(true);
    expect(r.consumedMonthly).toBe(5);
    expect(r.consumedPurchased).toBe(0);
    expect(count(store)).toBe(5);
  });

  it('月次不足: 月次を使い切り不足分を purchased から消費（内訳を返す）', async () => {
    const { db, store } = makeDb({ usage: { count: 998 }, sub: { planTier: 'pro', purchasedCredits: 10 } }); // 残 monthly2
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 5);
    expect(r.ok).toBe(true);
    expect(r.consumedMonthly).toBe(2);
    expect(r.consumedPurchased).toBe(3);
    expect(count(store)).toBe(1000);    // 月次は上限まで
    expect(purchased(store)).toBe(7);   // purchased から3
  });

  // 無料枠廃止（2026-08-25）の要点: 月次を 0 にしても購入済み残高には触れない。
  // ここが壊れると「課金したのに使えない / 残高が消えた」になる
  it('free（月次 0）でも購入クレジットだけで消費できる', async () => {
    const { db, store } = makeDb({ sub: { purchasedCredits: 10 } }); // planTier 無し = free
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 4);
    expect(r.ok).toBe(true);
    expect(r.consumedMonthly).toBe(0);   // 月次からは 1cr も引かない
    expect(r.consumedPurchased).toBe(4);
    expect(purchased(store)).toBe(6);
  });

  it('free で購入クレジットが無ければ ok:false（購入済み残高は不変）', async () => {
    const { db, store } = makeDb({ sub: { purchasedCredits: 0 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 1);
    expect(r.ok).toBe(false);
    expect(purchased(store)).toBe(0);
  });

  it('purchased でも足りなければ ok:false（消費なし）', async () => {
    const { db, store } = makeDb({ usage: { count: 50 }, sub: { purchasedCredits: 2 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 5);
    expect(r.ok).toBe(false);
    expect(r.consumedMonthly).toBe(0);
    expect(r.consumedPurchased).toBe(0);
    expect(count(store)).toBe(50);      // 変化なし
    expect(purchased(store)).toBe(2);
  });
});

describe('refundAiCredit の内訳対称払い戻し（Day39 の核）', () => {
  beforeEach(() => mocks.getAdminDb.mockReset());

  it('内訳指定: purchased から引いた分は purchased へ戻す（月次に化けさせない）', async () => {
    // reserve 後の状態: monthly 上限50・purchased 7（内訳 monthly2/purchased3 を消費済み）
    const { db, store } = makeDb({ usage: { count: 50 }, sub: { purchasedCredits: 7 } });
    mocks.getAdminDb.mockReturnValue(db);
    await refundAiCredit('u1', 5, { consumedMonthly: 2, consumedPurchased: 3 });
    expect(count(store)).toBe(48);      // 月次は2だけ戻す
    expect(purchased(store)).toBe(10);  // purchased は3戻り完全復元
  });

  it('内訳なし（旧フォールバック）: 月次優先で戻す＝purchased 復元されず（バグ挙動の記録）', async () => {
    const { db, store } = makeDb({ usage: { count: 50 }, sub: { purchasedCredits: 7 } });
    mocks.getAdminDb.mockReturnValue(db);
    await refundAiCredit('u1', 5); // 内訳なし
    expect(count(store)).toBe(45);      // 5全部を月次へ
    expect(purchased(store)).toBe(7);   // purchased は戻らない（＝内訳指定で解消される問題）
  });

  it('reserve→refund の往復（内訳受け渡し）で完全に元へ戻る', async () => {
    const { db, store } = makeDb({ usage: { count: 998 }, sub: { planTier: 'pro', purchasedCredits: 10 } });
    mocks.getAdminDb.mockReturnValue(db);
    const r = await reserveAiCredit('u1', 5);
    expect([count(store), purchased(store)]).toEqual([1000, 7]); // 消費後
    await refundAiCredit('u1', 5, r);
    expect([count(store), purchased(store)]).toEqual([998, 10]); // 完全復元
  });
});
