import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// iap/grant の POST を Admin SDK モック＋フェイク Firestore で検証する（Day73）。
// StoreKit 2 の購入完了から呼ばれ purchasedCredits（永続クレジット）を加算する money 境界。
// Apple サーバでの JWS 署名検証（verify-apple-jws）は crypto/外部依存のためモックし、
// **付与ロジックの不変条件**を固定する:
//   - transactionId を冪等キーに account_iap_transactions/{txId} で 1 回だけ付与（二重付与しない）
//   - JWS payload の productId / transactionId / bundleId が申告と一致しなければ付与しない
//   - 未知 productId / 署名検証失敗は付与しない

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), product: vi.fn(), jws: vi.fn(), decode: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/iap/products', () => ({ getIapProduct: mocks.product }));
vi.mock('@/lib/iap/verify-apple-jws', () => ({ verifyAppleJws: mocks.jws, decodeAppleJwsPayload: mocks.decode }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__ST__' },
}));

import { POST } from '../../src/app/api/iap/grant/route';

function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const merge = (p: string, d: Record<string, unknown>) => {
    const cur = { ...(store[p] ?? {}) };
    for (const [k, v] of Object.entries(d)) {
      if (v && typeof v === 'object' && '__inc' in (v as Record<string, unknown>)) {
        cur[k] = (typeof cur[k] === 'number' ? (cur[k] as number) : 0) + (v as { __inc: number }).__inc;
      } else cur[k] = v;
    }
    store[p] = cur;
  };
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

const OK_PAYLOAD = { productId: 'cr_100', transactionId: 'TX1', bundleId: 'com.noxa.app', signedDate: 123 };
const BASE = { transactionId: 'TX1', signedTransactionJws: 'JWS', productId: 'cr_100', environment: 'production' };
const TX_PATH = 'account_iap_transactions/TX1';
const SUB_PATH = 'account_subscriptions/u1';

describe('iap/grant POST（購入クレジット付与の冪等・整合境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
    mocks.product.mockReset().mockImplementation((pid: string) =>
      pid === 'cr_100' ? { productId: 'cr_100', credits: 100, priceJpy: 500 } : undefined,
    );
    mocks.jws.mockReset().mockReturnValue({ ok: true, payload: OK_PAYLOAD });
    mocks.decode.mockReset().mockReturnValue(null);
    delete process.env.APPLE_IAP_BUNDLE_ID;
  });
  afterEach(() => {
    delete process.env.APPLE_IAP_BUNDLE_ID;
  });

  it('必須フィールド欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ transactionId: 'TX1' }))).status).toBe(400);
  });

  it('未知の productId は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req({ ...BASE, productId: 'nope' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('未知の productId');
  });

  it('署名検証に失敗し decode もできなければ 403（付与しない）', async () => {
    mocks.jws.mockReturnValue({ ok: false, reason: 'bad-signature' });
    mocks.decode.mockReturnValue(null);
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req(BASE));
    expect(r.status).toBe(403);
    expect(store[SUB_PATH]).toBeUndefined();
    expect(store[TX_PATH]).toBeUndefined();
  });

  it('JWS の productId が申告と一致しなければ 400', async () => {
    mocks.jws.mockReturnValue({ ok: true, payload: { ...OK_PAYLOAD, productId: 'cr_999' } });
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req(BASE));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('productId が JWS と一致');
  });

  it('JWS の transactionId が申告と一致しなければ 400', async () => {
    mocks.jws.mockReturnValue({ ok: true, payload: { ...OK_PAYLOAD, transactionId: 'OTHER' } });
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req(BASE));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('transactionId が JWS と一致');
  });

  it('APPLE_IAP_BUNDLE_ID 設定時、bundleId 不一致は 400', async () => {
    process.env.APPLE_IAP_BUNDLE_ID = 'com.expected.app';
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req(BASE));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('bundleId');
    expect(store[SUB_PATH]).toBeUndefined(); // 付与しない
  });

  it('成功: purchasedCredits に商品分を加算し、冪等キーを記録して残高を返す', async () => {
    const { db, store } = makeDb({ [SUB_PATH]: { purchasedCredits: 50 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req(BASE));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, granted: 100, productId: 'cr_100', purchasedCredits: 150 });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(150); // 50 + 100
    expect(store[TX_PATH]).toBeDefined(); // 冪等キー書き込み
    expect((store[TX_PATH] as { credits?: number; uid?: string }).credits).toBe(100);
    expect((store[TX_PATH] as { uid?: string }).uid).toBe('u1');
  });

  it('🔁二重付与防止: 同一 transactionId が処理済みなら 409（クレジットを加算しない）', async () => {
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100 }, // 既に処理済み
      [SUB_PATH]: { purchasedCredits: 200 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req(BASE));
    expect(r.status).toBe(409);
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(200); // 不変＝二重付与しない
  });
});
