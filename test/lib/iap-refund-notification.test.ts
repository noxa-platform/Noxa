import { describe, it, expect, beforeEach, vi } from 'vitest';

// App Store Server Notifications V2 の REFUND/REVOKE クレジット取り消し（Day40）を検証する。
// 核心の回帰: refunded 判定・減算・フラグ立てを同一トランザクションで完結させ、
// Apple の重複/リトライ通知が来ても purchasedCredits を二重減算しないこと。

const mocks = vi.hoisted(() => ({
  getAdminDb: vi.fn(),
  verifyAppleJws: vi.fn(),
  decodeAppleJwsPayload: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getAdminDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/lib/iap/verify-apple-jws', () => ({
  verifyAppleJws: mocks.verifyAppleJws,
  decodeAppleJwsPayload: mocks.decodeAppleJwsPayload,
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__', increment: (n: number) => ({ __increment: n }) },
}));

import { POST } from '../../src/app/api/iap/notifications-v2/route';

type Slot = Record<string, unknown> | undefined;

function makeDb(seed: { tx?: Record<string, unknown>; sub?: Record<string, unknown> } = {}) {
  const store: { tx: Slot; sub: Slot } = {
    tx: seed.tx ? { ...seed.tx } : undefined,
    sub: seed.sub ? { ...seed.sub } : undefined,
  };
  const slotOf = (path: string): 'tx' | 'sub' => {
    if (path.includes('account_iap_transactions')) return 'tx';
    if (path.includes('account_subscriptions')) return 'sub';
    throw new Error(`unexpected path: ${path}`);
  };
  const mergeInto = (slot: 'tx' | 'sub', data: Record<string, unknown>) => {
    const cur: Record<string, unknown> = store[slot] ? { ...store[slot] } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && '__increment' in (v as Record<string, unknown>)) {
        cur[k] = (typeof cur[k] === 'number' ? (cur[k] as number) : 0) + (v as { __increment: number }).__increment;
      } else { cur[k] = v; }
    }
    store[slot] = cur;
  };
  const snapOf = (slot: 'tx' | 'sub') => ({ exists: store[slot] !== undefined, data: () => store[slot] });
  const makeRef = (path: string) => {
    const slot = slotOf(path);
    return { path, get: async () => snapOf(slot), set: async (d: Record<string, unknown>) => mergeInto(slot, d) };
  };
  const db = {
    doc: (path: string) => makeRef(path),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { path: string }, d: Record<string, unknown>) => mergeInto(slotOf(ref.path), d),
    }),
  };
  return { db, store };
}

const TXID = 'tx_123';
const req = () => ({ json: async () => ({ signedPayload: 'NOTIF' }) }) as unknown as Parameters<typeof POST>[0];

/** notificationType に応じた JWS モックを仕込む */
function setupJws(notificationType: string) {
  mocks.verifyAppleJws.mockImplementation((jws: string) => {
    if (jws === 'NOTIF') return { ok: true, payload: { notificationType, data: { signedTransactionInfo: 'TXINFO' } } };
    if (jws === 'TXINFO') return { ok: true, payload: { transactionId: TXID, productId: 'credits_100' } };
    return { ok: false, reason: 'unknown' };
  });
}
const sub = (s: { sub: Slot }) => (s.sub as { purchasedCredits?: number })?.purchasedCredits;
const txRefunded = (s: { tx: Slot }) => (s.tx as { refunded?: boolean })?.refunded;

describe('notifications-v2 REFUND/REVOKE', () => {
  beforeEach(() => {
    mocks.getAdminDb.mockReset();
    mocks.verifyAppleJws.mockReset();
    mocks.decodeAppleJwsPayload.mockReset();
    delete process.env.APPLE_IAP_BUNDLE_ID; // bundleId チェックをスキップ
  });

  it('REFUND: 該当 uid の purchasedCredits を減算し refunded を立てる', async () => {
    setupJws('REFUND');
    const { db, store } = makeDb({ tx: { uid: 'u1', credits: 100 }, sub: { purchasedCredits: 100 } });
    mocks.getAdminDb.mockReturnValue(db);

    const res = await POST(req());
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, revoked: 100 });
    expect(sub(store)).toBe(0);
    expect(txRefunded(store)).toBe(true);
  });

  it('REFUND: 残高より多い取り消しでも 0 でクランプ（負値にしない）', async () => {
    setupJws('REFUND');
    const { db, store } = makeDb({ tx: { uid: 'u1', credits: 100 }, sub: { purchasedCredits: 30 } });
    mocks.getAdminDb.mockReturnValue(db);

    await POST(req());
    expect(sub(store)).toBe(0);
  });

  it('重複通知（2回目）は二重減算しない＝冪等（tx 内 refunded ガード）', async () => {
    setupJws('REFUND');
    const { db, store } = makeDb({ tx: { uid: 'u1', credits: 100 }, sub: { purchasedCredits: 100 } });
    mocks.getAdminDb.mockReturnValue(db);

    const r1 = await (await POST(req())).json();
    expect(r1).toMatchObject({ revoked: 100 });
    expect(sub(store)).toBe(0);

    // Apple のリトライ相当: 同一 transactionId で再送 → 減算されない
    const r2 = await (await POST(req())).json();
    expect(r2).toMatchObject({ ok: true, alreadyRefunded: true });
    expect(sub(store)).toBe(0); // 二重減算されていない
  });

  it('未知の transaction は無視（減算しない）', async () => {
    setupJws('REFUND');
    const { db, store } = makeDb({ sub: { purchasedCredits: 100 } }); // tx doc なし
    mocks.getAdminDb.mockReturnValue(db);

    const json = await (await POST(req())).json();
    expect(json).toMatchObject({ ok: true, ignored: 'unknown transaction' });
    expect(sub(store)).toBe(100); // 変化なし
  });

  it('REVOKE も同様にクレジットを取り消す', async () => {
    setupJws('REVOKE');
    const { db, store } = makeDb({ tx: { uid: 'u1', credits: 100 }, sub: { purchasedCredits: 100 } });
    mocks.getAdminDb.mockReturnValue(db);

    const json = await (await POST(req())).json();
    expect(json).toMatchObject({ ok: true, revoked: 100 });
    expect(sub(store)).toBe(0);
  });
});
