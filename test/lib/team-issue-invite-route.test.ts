import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/issue-invite（店舗メンバー招待コードの発行＝**権限が配られる唯一の入口**）の
// characterization テスト（Day104・それまでゼロカバレッジ）。
// 固定する境界:
//   - 入力検証: shopId 必須＋doc ID として安全（`/` 入りのパス injection を弾く）
//   - role の allowlist: cast/manager/accounting のみ。**owner は招待経由で配れない**
//   - 認可: owner / manager のみ（cast・accounting は 403、非メンバーは 404）
//   - 発行物: 10 文字・紛らわしい文字（0/O/1/I/L）を含まないコード、7 日後失効、
//             usedBy は付けない（受諾時に redeem API が書く）
//   - 参加 URL: origin ヘッダ優先＋クエリは encodeURIComponent
//   - 認証失敗 = 401 / 書込失敗 = 500

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => {
  class Timestamp {
    _ms: number;
    constructor(ms: number) { this._ms = ms; }
    toMillis() { return this._ms; }
    static fromMillis(ms: number) { return new Timestamp(ms); }
  }
  return {
    Timestamp,
    FieldValue: { serverTimestamp: () => '<serverTimestamp>' },
  };
});

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/team/issue-invite/route';

/** doc().get() / doc().set() 対応の最小フェイク（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  const db = {
    doc: (p: string) => {
      // Firestore の実挙動: doc パスはセグメント数が偶数でなければ throw
      if (p.split('/').length % 2 !== 0) throw new Error(`Invalid document path: ${p}`);
      return {
        get: async () => ({ exists: store[p] !== undefined, data: () => store[p] }),
        set: async (data: Record<string, unknown>) => { store[p] = data; writes.push({ path: p, data }); },
      };
    },
  };
  return { db, store, writes };
}

const SHOP = {
  'shop_shops/s1': { ownerUid: 'owner1', name: 'テスト店' },
  'shop_shops/s1/members/mgr1': { role: 'manager' },
  'shop_shops/s1/members/cast1': { role: 'cast' },
  'shop_shops/s1/members/reg1': { role: 'accounting' },
};

/** NextRequest の最小フェイク（json / headers.get('origin') / nextUrl.origin） */
const req = (body: unknown, origin: string | null = 'https://noxa-delta.vercel.app') =>
  ({
    json: async () => body,
    headers: { get: (k: string) => (k === 'origin' ? origin : null) },
    nextUrl: { origin: 'https://fallback.example' },
  }) as never;

const json = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()) as Record<string, string>;

describe('team/issue-invite POST（招待コード発行の入力検証・認可・発行物）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('owner1');
    mocks.getDb.mockReset();
  });

  it('shopId 欠落・非文字列は 400（DB に触れない）', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req({ role: 'cast' }))).status).toBe(400);
    expect((await POST(req({ shopId: 123, role: 'cast' }))).status).toBe(400);
    expect((await POST(req({ shopId: '', role: 'cast' }))).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('shopId に `/` を含むパス injection は 400（Admin SDK は rules を通らないため）', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    // 奇数セグメントになる値は素通しすると db.doc() が throw して 500 になる
    const res = await POST(req({ shopId: 's1/members/cast1', role: 'manager' }));
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('role の allowlist 外は 400（owner は招待経由で配れない）', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    for (const role of [undefined, '', 'owner', 'admin', 'CAST', 'cast ']) {
      expect((await POST(req({ shopId: 's1', role }))).status).toBe(400);
    }
    expect(writes).toHaveLength(0);
  });

  it('非メンバーは 404 / cast・accounting は 403（発行は owner/manager のみ）', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);

    mocks.verify.mockResolvedValue('stranger');
    expect((await POST(req({ shopId: 's1', role: 'cast' }))).status).toBe(404);
    // 店が無い場合も 404
    expect((await POST(req({ shopId: 'nope', role: 'cast' }))).status).toBe(404);

    mocks.verify.mockResolvedValue('cast1');
    expect((await POST(req({ shopId: 's1', role: 'cast' }))).status).toBe(403);
    mocks.verify.mockResolvedValue('reg1');
    expect((await POST(req({ shopId: 's1', role: 'cast' }))).status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('owner: invites/{code} に role/createdBy/expiresAt を書き、usedBy は付けない', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    const before = Date.now();
    const res = await POST(req({ shopId: 's1', role: 'manager' }));
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`shop_shops/s1/invites/${body.code}`);
    expect(writes[0].data.role).toBe('manager');
    expect(writes[0].data.createdBy).toBe('owner1');
    // 未使用のうちは usedBy を書かない（redeem 側の「使用済み」判定が誤爆しない）
    expect('usedBy' in writes[0].data).toBe(false);

    // 7 日後失効
    const expiresAt = Number(body.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * 86400000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
    expect((writes[0].data.expiresAt as { toMillis(): number }).toMillis()).toBe(expiresAt);
  });

  it('manager も発行できる（店長がキャストを呼べる）', async () => {
    const { db, writes } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    mocks.verify.mockResolvedValue('mgr1');
    const res = await POST(req({ shopId: 's1', role: 'cast' }));
    expect(res.status).toBe(200);
    expect(writes[0].data.createdBy).toBe('mgr1');
  });

  it('コードは 10 文字・紛らわしい文字（0/O/1/I/L）を含まず、毎回変わる', async () => {
    const { db } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const body = await json(await POST(req({ shopId: 's1', role: 'cast' })));
      expect(body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
      codes.add(body.code);
    }
    expect(codes.size).toBe(30); // 連続発行で衝突しない
  });

  it('参加 URL は origin ヘッダ優先・無ければ nextUrl.origin にフォールバック', async () => {
    const { db } = makeDb(SHOP);
    mocks.getDb.mockReturnValue(db);
    const a = await json(await POST(req({ shopId: 's1', role: 'cast' })));
    expect(a.url).toBe(`https://noxa-delta.vercel.app/store/join?shop=s1&code=${a.code}`);

    const b = await json(await POST(req({ shopId: 's1', role: 'cast' }, null)));
    expect(b.url).toBe(`https://fallback.example/store/join?shop=s1&code=${b.code}`);
  });

  it('URL のクエリは encodeURIComponent される', async () => {
    const { db } = makeDb({ ...SHOP, 'shop_shops/a b&c': { ownerUid: 'owner1' } });
    mocks.getDb.mockReturnValue(db);
    const body = await json(await POST(req({ shopId: 'a b&c', role: 'cast' })));
    expect(body.url).toContain('?shop=a%20b%26c&code=');
  });

  it('認証失敗は 401 / 書込失敗は 500', async () => {
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    mocks.verify.mockRejectedValueOnce(new AuthError('bad token'));
    expect((await POST(req({ shopId: 's1', role: 'cast' }))).status).toBe(401);

    const { db } = makeDb(SHOP);
    mocks.getDb.mockReturnValue({
      ...db,
      doc: (p: string) => {
        const d = db.doc(p);
        return p.includes('/invites/') ? { ...d, set: async () => { throw new Error('write failed'); } } : d;
      },
    });
    mocks.verify.mockResolvedValue('owner1');
    expect((await POST(req({ shopId: 's1', role: 'cast' }))).status).toBe(500);
  });
});
