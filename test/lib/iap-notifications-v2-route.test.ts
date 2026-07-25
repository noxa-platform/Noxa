import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// iap/notifications-v2 の POST を Admin SDK モック＋フェイク Firestore で検証する（Day74）。
// App Store Server Notifications V2 の REFUND / REVOKE を受けて purchasedCredits を
// 取り戻す money 負値境界。JWS 署名検証（Apple 照合）はモックし、取り戻しロジックの
// 不変条件を固定する:
//   - REFUND/REVOKE で該当 transactionId の credits 分だけ purchasedCredits を減算
//   - refunded 済みなら二重減算しない（tx 内フラグ判定＝Apple の重複通知に冪等）
//   - purchasedCredits は 0 未満にしない（消費済みでも負にならない）
//   - unknown / noop(credits<=0) / bundleId 不一致 / 対象外 type は残高を動かさない

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), jws: vi.fn(), decode: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/iap/verify-apple-jws', () => ({ verifyAppleJws: mocks.jws, decodeAppleJwsPayload: mocks.decode }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__ST__' } }));

import { POST } from '../../src/app/api/iap/notifications-v2/route';

function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const merge = (p: string, d: Record<string, unknown>) => { store[p] = { ...(store[p] ?? {}), ...d }; };
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const ref = (p: string) => ({ path: p, get: async () => snap(p), set: async (d: Record<string, unknown>) => merge(p, d) });
  const db = {
    doc: (p: string) => ref(p),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({ get: async (r: { path: string }) => snap(r.path), set: (r: { path: string }, d: Record<string, unknown>) => merge(r.path, d) }),
  };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;

const TX_PATH = 'account_iap_transactions/TX1';
const SUB_PATH = 'account_subscriptions/u1';
const TXINFO = { transactionId: 'TX1', bundleId: 'com.noxa.app', productId: 'cr_100' };
const notif = (type: string) => ({ notificationType: type, data: { bundleId: 'com.noxa.app', signedTransactionInfo: 'TXINFO' } });

// verifyAppleJws を JWS 文字列で分岐（'NOTIF'→通知, 'TXINFO'→取引情報）
function setJws(notification: unknown, txInfo: unknown) {
  mocks.jws.mockImplementation((j: string) => {
    if (j === 'NOTIF') return { ok: true, payload: notification };
    if (j === 'TXINFO') return { ok: true, payload: txInfo };
    return { ok: false, reason: 'unexpected' };
  });
}

describe('iap/notifications-v2 POST（返金クレジット取り戻しの冪等境界）', () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.jws.mockReset();
    mocks.decode.mockReset().mockReturnValue(null);
    delete process.env.APPLE_IAP_BUNDLE_ID;
  });
  afterEach(() => {
    delete process.env.APPLE_IAP_BUNDLE_ID;
  });

  it('signedPayload 欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({}))).status).toBe(400);
  });

  it('notificationType が無い payload は 400', async () => {
    setJws({ data: {} }, null);
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(r.status).toBe(400);
  });

  it('REFUND: 該当 tx の credits 分だけ purchasedCredits を減算し refunded フラグを立てる', async () => {
    setJws(notif('REFUND'), TXINFO);
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100, refunded: false },
      [SUB_PATH]: { purchasedCredits: 150 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toEqual({ ok: true, revoked: 100 });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(50); // 150 - 100
    expect((store[TX_PATH] as { refunded?: boolean; refundType?: string }).refunded).toBe(true);
    expect((store[TX_PATH] as { refundType?: string }).refundType).toBe('REFUND');
  });

  it('🔁二重通知: 既に refunded 済みなら残高を動かさない（alreadyRefunded）', async () => {
    setJws(notif('REFUND'), TXINFO);
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100, refunded: true },
      [SUB_PATH]: { purchasedCredits: 50 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toEqual({ ok: true, alreadyRefunded: true });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(50); // 不変＝二重減算しない
  });

  it('REFUND: purchasedCredits を 0 未満にしない（消費済みは 0 で下げ止まり）', async () => {
    setJws(notif('REFUND'), TXINFO);
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100, refunded: false },
      [SUB_PATH]: { purchasedCredits: 30 }, // 既に消費して 30 しか残っていない
    });
    mocks.getDb.mockReturnValue(db);

    await POST(req({ signedPayload: 'NOTIF' }));
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(0); // max(0, 30-100)
    expect((store[TX_PATH] as { refunded?: boolean }).refunded).toBe(true);
  });

  it('REVOKE も同じ取り戻し経路（refundType=REVOKE）', async () => {
    setJws(notif('REVOKE'), TXINFO);
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 40, refunded: false },
      [SUB_PATH]: { purchasedCredits: 100 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toEqual({ ok: true, revoked: 40 });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(60);
    expect((store[TX_PATH] as { refundType?: string }).refundType).toBe('REVOKE');
  });

  it('未知 transaction: 残高を触らず ignored', async () => {
    setJws(notif('REFUND'), TXINFO);
    const { db, store } = makeDb({});
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toMatchObject({ ok: true, ignored: 'unknown transaction' });
    expect(store[SUB_PATH]).toBeUndefined();
  });

  it('bundleId 不一致は ignored（残高を触らない）', async () => {
    process.env.APPLE_IAP_BUNDLE_ID = 'com.noxa.app';
    setJws(notif('REFUND'), { ...TXINFO, bundleId: 'com.evil.app' });
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100, refunded: false },
      [SUB_PATH]: { purchasedCredits: 150 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toMatchObject({ ok: false, ignored: 'bundleId mismatch' });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(150); // 不変
  });

  it('CONSUMPTION_REQUEST / 対象外 type は残高を動かさず ok', async () => {
    setJws(notif('CONSUMPTION_REQUEST'), TXINFO);
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ signedPayload: 'NOTIF' }))).status).toBe(200);

    setJws(notif('DID_RENEW'), TXINFO);
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req({ signedPayload: 'NOTIF' }));
    expect(await r.json()).toMatchObject({ ok: true, ignored: 'DID_RENEW' });
  });
});
