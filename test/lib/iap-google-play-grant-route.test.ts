import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// iap/google-play-grant の POST を Admin SDK モック＋フェイク Firestore で検証する（Day75）。
// Android Google Play Billing の購入完了から purchasedCredits を加算する money 境界（iOS 版と対称）。
// Google Play Developer API の実検証は googleapis/外部依存のため、非本番の検証 skip
// （IAP_ALLOW_UNVERIFIED='true' かつ Service Account 未設定）を利用して回避し、付与ロジックを固定する:
//   - packageName / productId / purchaseToken 必須
//   - GOOGLE_PLAY_PACKAGE_NAME 設定時は packageName 一致必須（なりすまし防止）
//   - 未知 productId / 検証失敗は付与しない
//   - transactionId = `gplay_<purchaseToken>` を冪等キーに 1 回だけ付与（二重付与しない）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), product: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/iap/products', () => ({ getIapProductByAndroidId: mocks.product }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__ST__' },
}));

import { POST } from '../../src/app/api/iap/google-play-grant/route';

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

const BASE = { packageName: 'jp.noxa', productId: 'and_cr100', purchaseToken: 'TOK1', orderId: 'O1' };
const TX_PATH = 'account_iap_transactions/gplay_TOK1';
const SUB_PATH = 'account_subscriptions/u1';

describe('iap/google-play-grant POST（Android 購入クレジット付与の冪等・整合境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
    mocks.product.mockReset().mockImplementation((pid: string) =>
      pid === 'and_cr100' ? { productId: 'cr_100', credits: 100, priceJpy: 500 } : undefined,
    );
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
    delete process.env.IAP_ALLOW_UNVERIFIED;
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_PLAY_PACKAGE_NAME;
    delete process.env.IAP_ALLOW_UNVERIFIED;
  });
  // 検証 skip（非本番＋明示フラグ＋SA 未設定）を有効化する
  const allowSkip = () => { process.env.IAP_ALLOW_UNVERIFIED = 'true'; };

  it('必須フィールド欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ packageName: 'jp.noxa' }))).status).toBe(400);
  });

  it('GOOGLE_PLAY_PACKAGE_NAME と packageName 不一致は 400（なりすまし防止）', async () => {
    process.env.GOOGLE_PLAY_PACKAGE_NAME = 'jp.other';
    allowSkip();
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req(BASE));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('packageName');
    expect(store[SUB_PATH]).toBeUndefined();
  });

  it('未知の productId は 400', async () => {
    allowSkip();
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req({ ...BASE, productId: 'nope' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('未知の productId');
  });

  it('検証失敗（skip フラグなし・Service Account 未設定）は 400（付与しない）', async () => {
    // IAP_ALLOW_UNVERIFIED を立てない → verifyGooglePlayPurchase は ok:false
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req(BASE));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('Google Play 検証失敗');
    expect(store[SUB_PATH]).toBeUndefined();
    expect(store[TX_PATH]).toBeUndefined();
  });

  it('成功: purchasedCredits に商品分を加算し gplay_ 冪等キーを記録', async () => {
    allowSkip();
    const { db, store } = makeDb({ [SUB_PATH]: { purchasedCredits: 20 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req(BASE));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, granted: 100, productId: 'cr_100', purchasedCredits: 120 });
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(120); // 20 + 100
    expect(store[TX_PATH]).toBeDefined();
    expect((store[TX_PATH] as { platform?: string; credits?: number }).platform).toBe('android');
    expect((store[TX_PATH] as { credits?: number }).credits).toBe(100);
  });

  // P146: 素性（テスト購入かどうか）を記録する。iOS 側と同じ穴で、Android は
  // これまで purchaseType を一切保存しておらず、後から本物の購入か判断できなかった。
  it('検証 skip 経路では素性を unknown として残す（欠落を normal に倒さない）', async () => {
    allowSkip();
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);

    expect((await POST(req(BASE))).status).toBe(200);
    const tx = store[TX_PATH] as Record<string, unknown>;
    // Play に問い合わせていない以上「通常購入」とは言えない。
    // ここを normal にすると、検証を飛ばした付与が実購入として記録に残る
    expect(tx.purchaseKind).toBe('unknown');
    expect(tx.environmentSource).toBe('unverified');
  });

  it('🔁二重付与防止: 同一 purchaseToken が処理済みなら 409（クレジットを加算しない）', async () => {
    allowSkip();
    const { db, store } = makeDb({
      [TX_PATH]: { uid: 'u1', credits: 100 },
      [SUB_PATH]: { purchasedCredits: 200 },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req(BASE));
    expect(r.status).toBe(409);
    expect((store[SUB_PATH] as { purchasedCredits?: number }).purchasedCredits).toBe(200); // 不変
  });
});
