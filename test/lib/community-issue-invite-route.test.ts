import { describe, it, expect, beforeEach, vi } from 'vitest';

// community/issue-invite の POST を Admin SDK モック＋フェイク Firestore で検証する（Day71）。
// 招待コード発行は招待枠（inviteCredits）を 1 消費する anti-abuse 境界。tx でクレジット検証と
// 消費を原子化して「同時押しでマイナスにしない」ことを担保する。以下の不変条件を固定:
//   - admin は無制限発行（枠を消費しない・inviteCredits: null）
//   - 会員は枠 > 0 かつ発行権停止でないときのみ発行し 1 消費
//   - 枠 0 / 発行権停止 / 非会員は 403 で発行しない（招待 doc を作らない）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => ({ toMillis: () => 1000, toDate: () => new Date(1000) }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
  },
}));

import { POST } from '../../src/app/api/community/issue-invite/route';

/** account_users / noxa_users / noxa_invites を持つ最小フェイク（tx は単純適用） */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const setP = (p: string, d: Record<string, unknown>) => { store[p] = { ...d }; };
  const updP = (p: string, d: Record<string, unknown>) => { store[p] = { ...(store[p] ?? {}), ...d }; };
  const ref = (p: string) => ({
    path: p,
    get: async () => snap(p),
    set: async (d: Record<string, unknown>) => setP(p, d),
    update: async (d: Record<string, unknown>) => updP(p, d),
  });
  const db = {
    doc: (p: string) => ref(p),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        get: async (r: { path: string }) => snap(r.path),
        set: (r: { path: string }, d: Record<string, unknown>) => setP(r.path, d),
        update: (r: { path: string }, d: Record<string, unknown>) => updP(r.path, d),
      }),
  };
  return { db, store };
}
const req = () => ({}) as never;
const inviteDoc = (store: Record<string, Record<string, unknown> | undefined>) => {
  const key = Object.keys(store).find((k) => k.startsWith('noxa_invites/'));
  return key ? store[key] : undefined;
};

describe('community/issue-invite POST（招待枠の anti-abuse 境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
  });

  it('admin: 無制限発行（枠を消費せず inviteCredits: null・invite は active）', async () => {
    const { db, store } = makeDb({ 'account_users/u1': { platformRole: 'admin' } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.inviteCredits).toBeNull();
    expect(typeof j.code).toBe('string');
    const inv = inviteDoc(store) as { status?: string; issuedBy?: string; usedBy?: unknown };
    expect(inv.status).toBe('active');
    expect(inv.issuedBy).toBe('u1');
    expect(inv.usedBy).toBeNull();
  });

  it('会員(枠3): 発行して枠を 1 消費（残 2）', async () => {
    const { db, store } = makeDb({ 'noxa_users/u1': { inviteCredits: 3 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.inviteCredits).toBe(2);
    expect((store['noxa_users/u1'] as { inviteCredits?: number }).inviteCredits).toBe(2);
    expect(inviteDoc(store)).toBeDefined();
  });

  it('会員(枠0): 403「招待枠が残っていません」・invite を作らない・枠は不変', async () => {
    const { db, store } = makeDb({ 'noxa_users/u1': { inviteCredits: 0 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('招待枠');
    expect(inviteDoc(store)).toBeUndefined();
    expect((store['noxa_users/u1'] as { inviteCredits?: number }).inviteCredits).toBe(0);
  });

  it('発行権停止(invitePrivilegeRevoked): 枠が残っていても 403・発行しない', async () => {
    const { db, store } = makeDb({ 'noxa_users/u1': { inviteCredits: 5, invitePrivilegeRevoked: true } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('停止');
    expect(inviteDoc(store)).toBeUndefined();
    expect((store['noxa_users/u1'] as { inviteCredits?: number }).inviteCredits).toBe(5); // 消費しない
  });

  it('非会員(noxa_users doc 無し): 403「メンバーではありません」・発行しない', async () => {
    const { db, store } = makeDb({});
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('メンバー');
    expect(inviteDoc(store)).toBeUndefined();
  });
});
