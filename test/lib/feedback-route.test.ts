import { describe, it, expect, beforeEach, vi } from 'vitest';

// feedback GET を Admin SDK モック＋フェイク Firestore で検証する（Day83）。
//   - scope=public（認証不要）: status=approved かつ allowPublish のみ・承認済みフィールド優先・
//     persona/quote が空のものは除外して LP 配信形式で返す
//   - scope=admin（既定）: isAdmin(email) ゲート後に全 status を返す（非 admin=403・未認証=401）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), getUser: vi.fn(), isAdmin: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  getAdminAuth: () => ({ getUser: mocks.getUser }),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { GET } from '../../src/app/api/feedback/route';

/** collection().where().orderBy().limit().get() 対応の最小フェイク（== フィルタのみ）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const collDocs = (name: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(name + '/') && !k.slice(name.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(name.length + 1), data: () => store[k]! }));
  const db = {
    collection: (name: string) => {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        where: (f: string, _op: string, v: unknown) => { filters.push([f, v]); return chain; },
        orderBy: () => chain,
        limit: () => chain,
        get: async () => {
          let docs = collDocs(name);
          for (const [f, v] of filters) docs = docs.filter((d) => d.data()[f] === v);
          return { docs };
        },
      };
      return chain;
    },
  };
  return { db, store };
}
const reqGet = (scope?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(scope ? `scope=${scope}` : '') } }) as never;

const TESTIMONIALS = {
  'audit_testimonials/t1': { status: 'approved', allowPublish: true, approvedQuote: '最高でした', approvedPersonaLabel: '20代 会社員', approvedLocation: '大阪', quote: '原文' },
  'audit_testimonials/t2': { status: 'pending', allowPublish: true, quote: '審査中' },              // 未承認
  'audit_testimonials/t3': { status: 'approved', allowPublish: false, approvedQuote: 'x', approvedPersonaLabel: 'p' }, // 未許諾
  'audit_testimonials/t4': { status: 'approved', allowPublish: true, approvedQuote: 'y', approvedPersonaLabel: '' },   // persona 空
};

describe('feedback GET（LP 公開 / admin 一覧）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('admin1');
    mocks.getDb.mockReset();
    mocks.getUser.mockReset().mockResolvedValue({ email: 'admin@noxa.jp' });
    mocks.isAdmin.mockReset().mockImplementation((email?: string) => email === 'admin@noxa.jp');
  });

  it('scope=public: 承認+許諾のみ・承認済みフィールドで LP 形式・空 persona は除外（認証不要）', async () => {
    mocks.getDb.mockReturnValue(makeDb(TESTIMONIALS).db);
    const { items } = await (await GET(reqGet('public'))).json();
    expect(items).toEqual([{ id: 't1', quote: '最高でした', persona: '20代 会社員', location: '大阪' }]);
    expect(mocks.verify).not.toHaveBeenCalled(); // public は未認証で通る
  });

  it('scope=admin（既定）: 非 admin は 403', async () => {
    mocks.getUser.mockResolvedValue({ email: 'nobody@x.com' });
    mocks.getDb.mockReturnValue(makeDb(TESTIMONIALS).db);
    expect((await GET(reqGet())).status).toBe(403);
  });

  it('scope=admin: admin は全 status を返す', async () => {
    mocks.getDb.mockReturnValue(makeDb(TESTIMONIALS).db);
    const { items } = await (await GET(reqGet('admin'))).json();
    expect(items).toHaveLength(4);                       // 全件（未承認含む）
    expect(items.map((i: { id: string }) => i.id).sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('scope=admin: 認証失敗は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('unauth'));
    mocks.getDb.mockReturnValue(makeDb(TESTIMONIALS).db);
    expect((await GET(reqGet())).status).toBe(401);
  });
});
