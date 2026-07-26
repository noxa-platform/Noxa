import { describe, it, expect, beforeEach, vi } from 'vitest';

// community/admin/action の POST を Admin SDK モック＋フェイク Firestore で検証する（Day78）。
// 通報モデレーション実行（admin 専用・状態変更）の境界を固定する:
//   - admin ゲート（非 admin=403 / トークン不正=401）
//   - hide/unhide: thread→noxa_posts / reply→noxa_comments に hidden を set＋関連通報を resolved 化
//   - 不正 targetType / targetId 欠落は 400（何も変更しない）
//   - resolve: 対象は触らず通報だけ resolved 化
//   - revokeInvite/restoreInvite: uid 欠落=400 / 会員不在=404 / 正常で invitePrivilegeRevoked を切替
//   - 不明 action=400

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__' },
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/community/admin/action/route';

/** doc get/set・batch 対応の最小フェイク Firestore（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const setDoc = (p: string, d: Record<string, unknown>, o?: { merge?: boolean }) => {
    store[p] = o?.merge ? { ...(store[p] ?? {}), ...d } : { ...d };
  };
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const db = {
    doc: (p: string) => ({
      path: p,
      get: async () => snap(p),
      set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => setDoc(p, d, o),
    }),
    batch: () => {
      const ops: Array<[string, Record<string, unknown>, { merge?: boolean } | undefined]> = [];
      return {
        set: (ref: { path: string }, d: Record<string, unknown>, o?: { merge?: boolean }) => ops.push([ref.path, d, o]),
        commit: async () => { for (const [p, d, o] of ops) setDoc(p, d, o); },
      };
    },
  };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const ADMIN = { 'account_users/admin1': { platformRole: 'admin' } };

describe('community/admin/action POST（通報モデレーションの admin 境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('admin1');
    mocks.getDb.mockReset();
  });

  it('非 admin は 403（何も変更しない）', async () => {
    mocks.verify.mockResolvedValue('u1');
    const { db, store } = makeDb({ 'account_users/u1': { platformRole: 'user' }, 'noxa_posts/t1': { hidden: false } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'hide', targetType: 'thread', targetId: 't1' }));
    expect(r.status).toBe(403);
    expect((store['noxa_posts/t1'] as { hidden?: boolean }).hidden).toBe(false); // 不変
  });

  it('トークン不正（AuthError にトークンを含む）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証トークンが無効です'));
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ action: 'resolve', reportIds: ['r1'] }))).status).toBe(401);
  });

  it('hide(thread): noxa_posts に hidden=true・関連通報を resolved 化', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_posts/t1': { hidden: false }, 'noxa_reports/r1': { status: 'open' }, 'noxa_reports/r2': { status: 'open' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'hide', targetType: 'thread', targetId: 't1', reportIds: ['r1', 'r2'] }));
    expect(await r.json()).toEqual({ ok: true });
    expect((store['noxa_posts/t1'] as { hidden?: boolean; moderatedBy?: string }).hidden).toBe(true);
    expect((store['noxa_posts/t1'] as { moderatedBy?: string }).moderatedBy).toBe('admin1');
    expect((store['noxa_reports/r1'] as { status?: string; resolvedBy?: string }).status).toBe('resolved');
    expect((store['noxa_reports/r1'] as { resolvedBy?: string }).resolvedBy).toBe('admin1');
    expect((store['noxa_reports/r2'] as { status?: string }).status).toBe('resolved');
  });

  it('unhide(reply): noxa_comments に hidden=false', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_comments/c1': { hidden: true } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'unhide', targetType: 'reply', targetId: 'c1' }));
    expect(r.status).toBe(200);
    expect((store['noxa_comments/c1'] as { hidden?: boolean }).hidden).toBe(false);
  });

  it('不正 targetType（comment 等）は 400（何も変更しない）', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_comments/c1': { hidden: false } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'hide', targetType: 'comment', targetId: 'c1' }));
    expect(r.status).toBe(400);
    expect((store['noxa_comments/c1'] as { hidden?: boolean }).hidden).toBe(false);
  });

  it('targetId 欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb(ADMIN).db);
    expect((await POST(req({ action: 'hide', targetType: 'thread' }))).status).toBe(400);
  });

  it('resolve: 対象は触らず通報だけ resolved 化', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_posts/t1': { hidden: false }, 'noxa_reports/r1': { status: 'open' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'resolve', reportIds: ['r1'] }));
    expect(await r.json()).toEqual({ ok: true });
    expect((store['noxa_reports/r1'] as { status?: string }).status).toBe('resolved');
    expect((store['noxa_posts/t1'] as { hidden?: boolean }).hidden).toBe(false); // 対象は不変
  });

  it('resolveReports は非文字列 id を無視する', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_reports/r1': { status: 'open' } });
    mocks.getDb.mockReturnValue(db);
    await POST(req({ action: 'resolve', reportIds: ['r1', 123, null] }));
    expect((store['noxa_reports/r1'] as { status?: string }).status).toBe('resolved');
    expect(store['noxa_reports/123']).toBeUndefined(); // 数値 id は書かない
  });

  it('revokeInvite: 会員の invitePrivilegeRevoked=true', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_users/m1': { uid: 'm1' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ action: 'revokeInvite', uid: 'm1' }));
    expect(r.status).toBe(200);
    expect((store['noxa_users/m1'] as { invitePrivilegeRevoked?: boolean }).invitePrivilegeRevoked).toBe(true);
  });

  it('restoreInvite: invitePrivilegeRevoked=false', async () => {
    const { db, store } = makeDb({ ...ADMIN, 'noxa_users/m1': { invitePrivilegeRevoked: true } });
    mocks.getDb.mockReturnValue(db);
    await POST(req({ action: 'restoreInvite', uid: 'm1' }));
    expect((store['noxa_users/m1'] as { invitePrivilegeRevoked?: boolean }).invitePrivilegeRevoked).toBe(false);
  });

  it('revokeInvite: uid 欠落は 400 / 会員不在は 404', async () => {
    mocks.getDb.mockReturnValue(makeDb(ADMIN).db);
    expect((await POST(req({ action: 'revokeInvite' }))).status).toBe(400);
    mocks.getDb.mockReturnValue(makeDb(ADMIN).db);
    expect((await POST(req({ action: 'revokeInvite', uid: 'ghost' }))).status).toBe(404);
  });

  it('不明な action は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb(ADMIN).db);
    expect((await POST(req({ action: 'frobnicate' }))).status).toBe(400);
  });
});
