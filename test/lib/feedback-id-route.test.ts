import { describe, it, expect, beforeEach, vi } from 'vitest';

// feedback/[id] PATCH を Admin SDK モック＋フェイク Firestore で検証する（Day83）。
// testimonial の承認/却下（状態変更・admin 専用）。固定する境界:
//   - admin ゲート（非 admin=403 / 未認証=401）・action は approve/reject のみ（else 400）・不在=404
//   - reject: status=rejected + reviewedBy
//   - approve: quote(1-500)/persona(1-50)/location(≤40) 検証 + allowPublish 必須 → 承認フィールド保存
//     （掲載許諾が無ければ 400）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), getUser: vi.fn(), isAdmin: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  getAdminAuth: () => ({ getUser: mocks.getUser }),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__ST__' } }));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { PATCH } from '../../src/app/api/feedback/[id]/route';

/** collection().doc().get()/update() 対応の最小フェイク。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const docRef = (p: string) => ({
    get: async () => ({ exists: store[p] !== undefined, data: () => store[p] }),
    update: async (d: Record<string, unknown>) => { store[p] = { ...(store[p] ?? {}), ...d }; },
  });
  const db = { collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }) };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const KEY = 'audit_testimonials/t1';
const okApprove = { action: 'approve', approvedQuote: '最高でした', approvedPersonaLabel: '20代 会社員', approvedLocation: '大阪' };

describe('feedback/[id] PATCH（承認/却下の状態変更・admin 境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('admin1');
    mocks.getDb.mockReset();
    mocks.getUser.mockReset().mockResolvedValue({ email: 'admin@noxa.jp' });
    mocks.isAdmin.mockReset().mockImplementation((email?: string) => email === 'admin@noxa.jp');
  });

  it('非 admin は 403 / 未認証は 401', async () => {
    mocks.getUser.mockResolvedValue({ email: 'nobody@x.com' });
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req(okApprove), ctx('t1'))).status).toBe(403);

    mocks.verify.mockRejectedValue(new AuthError('unauth'));
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req(okApprove), ctx('t1'))).status).toBe(401);
  });

  it('不正 action は 400 / 対象不在は 404', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req({ action: 'delete' }), ctx('t1'))).status).toBe(400);
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await PATCH(req({ action: 'approve' }), ctx('ghost'))).status).toBe(404);
  });

  it('reject: status=rejected + reviewedBy を保存', async () => {
    const { db, store } = makeDb({ [KEY]: { status: 'pending', allowPublish: true } });
    mocks.getDb.mockReturnValue(db);
    const r = await PATCH(req({ action: 'reject' }), ctx('t1'));
    expect(await r.json()).toEqual({ ok: true });
    expect((store[KEY] as { status?: string; reviewedBy?: string }).status).toBe('rejected');
    expect((store[KEY] as { reviewedBy?: string }).reviewedBy).toBe('admin@noxa.jp');
  });

  it('approve: 検証通過＋許諾ありで承認フィールドを保存', async () => {
    const { db, store } = makeDb({ [KEY]: { status: 'pending', allowPublish: true, quote: '原文' } });
    mocks.getDb.mockReturnValue(db);
    const r = await PATCH(req(okApprove), ctx('t1'));
    expect(await r.json()).toEqual({ ok: true });
    const d = store[KEY] as Record<string, unknown>;
    expect(d.status).toBe('approved');
    expect(d.approvedQuote).toBe('最高でした');
    expect(d.approvedPersonaLabel).toBe('20代 会社員');
    expect(d.approvedLocation).toBe('大阪');
    expect(d.publishedAt).toBe('__ST__');
    expect(d.reviewedBy).toBe('admin@noxa.jp');
  });

  it('approve: 掲載許諾（allowPublish）が無ければ 400（承認しない）', async () => {
    const { db, store } = makeDb({ [KEY]: { status: 'pending', allowPublish: false } });
    mocks.getDb.mockReturnValue(db);
    expect((await PATCH(req(okApprove), ctx('t1'))).status).toBe(400);
    expect((store[KEY] as { status?: string }).status).toBe('pending'); // 不変
  });

  it('approve: quote 欠落 / 501 字は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req({ ...okApprove, approvedQuote: '' }), ctx('t1'))).status).toBe(400);
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req({ ...okApprove, approvedQuote: 'あ'.repeat(501) }), ctx('t1'))).status).toBe(400);
  });

  it('approve: persona 51 字 / location 41 字は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req({ ...okApprove, approvedPersonaLabel: 'あ'.repeat(51) }), ctx('t1'))).status).toBe(400);
    mocks.getDb.mockReturnValue(makeDb({ [KEY]: { allowPublish: true } }).db);
    expect((await PATCH(req({ ...okApprove, approvedLocation: 'あ'.repeat(41) }), ctx('t1'))).status).toBe(400);
  });
});
