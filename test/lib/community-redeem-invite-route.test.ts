import { describe, it, expect, beforeEach, vi } from 'vitest';

// community/redeem-invite の POST を Admin SDK モック＋非 clone フェイク Firestore で検証する（Day76）。
// 招待コードでコミュニティ会員になる境界。失効判定が `expiresAt instanceof Timestamp` を使うため、
// フェイク db は Timestamp インスタンスを保持する（JSON clone しない）。以下の不変条件を固定:
//   - 有効コード: noxa_users 作成 + invite を used 化 + 招待元へ通知（1回消費）
//   - 既会員 / admin: コードを消費しない（alreadyMember）
//   - 不在 / 使用済み / status≠active / 期限切れ は 400 で会員化しない
//   - issuedBy が無ければ通知しない

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
    static now() { return new Timestamp(Date.now()); }
    static fromMillis(ms: number) { return new Timestamp(ms); }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => '__ST__' } };
});

import { Timestamp } from 'firebase-admin/firestore';
import { POST } from '../../src/app/api/community/redeem-invite/route';

/** Timestamp 実体を保持する非 clone フェイク Firestore（doc / tx get-update-set / collection.add）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const added: Record<string, Record<string, unknown>[]> = {};
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const db = {
    doc: (p: string) => ({ path: p, get: async () => snap(p) }),
    collection: (name: string) => ({
      add: async (d: Record<string, unknown>) => { (added[name] ||= []).push(d); return { id: 'n1' }; },
    }),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        get: async (r: { path: string }) => snap(r.path),
        set: (r: { path: string }, d: Record<string, unknown>) => { store[r.path] = { ...d }; },
        update: (r: { path: string }, d: Record<string, unknown>) => { store[r.path] = { ...(store[r.path] ?? {}), ...d }; },
      }),
  };
  return { db, store, added };
}
const req = (body: unknown, ip: string | null = '1.2.3.4') =>
  ({ json: async () => body, headers: { get: (h: string) => (h === 'x-forwarded-for' ? ip : null) } }) as never;
const future = () => Timestamp.fromMillis(Date.now() + 1_000_000_000);
const past = () => Timestamp.fromMillis(Date.now() - 1_000_000);
const INVITE = 'noxa_invites/INV';
const USER = 'noxa_users/u1';
const notifCount = (added: Record<string, Record<string, unknown>[]>) => (added['notification_inbox'] ?? []).length;

describe('community/redeem-invite POST（招待引き換えの会員化境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
  });

  it('コード未入力は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ code: '' }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });

  it('招待コードが存在しなければ 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await POST(req({ code: 'INV' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('見つかりません');
  });

  it('有効コード: noxa_users 作成・invite を used 化・招待元へ通知（1回消費）', async () => {
    const { db, store, added } = makeDb({ [INVITE]: { status: 'active', issuedBy: 'owner', expiresAt: future() } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'INV' }));
    expect(await r.json()).toEqual({ ok: true, alreadyMember: false });
    expect(store[USER]).toBeDefined();
    expect((store[USER] as { invitedBy?: string; signupIp?: string }).invitedBy).toBe('owner');
    expect((store[USER] as { signupIp?: string }).signupIp).toBe('1.2.3.4');
    expect((store[INVITE] as { status?: string; usedBy?: string }).status).toBe('used');
    expect((store[INVITE] as { usedBy?: string }).usedBy).toBe('u1');
    expect(notifCount(added)).toBe(1);
  });

  it('既に会員: alreadyMember=true でコードを消費しない・通知しない', async () => {
    const { db, store, added } = makeDb({
      [USER]: { uid: 'u1' },
      [INVITE]: { status: 'active', issuedBy: 'owner', expiresAt: future() },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'INV' }));
    expect(await r.json()).toEqual({ ok: true, alreadyMember: true });
    expect((store[INVITE] as { status?: string }).status).toBe('active'); // 消費しない
    expect(notifCount(added)).toBe(0);
  });

  it('admin: alreadyMember 扱いでコードを消費しない（会員 doc も作らない）', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { platformRole: 'admin' },
      [INVITE]: { status: 'active', issuedBy: 'owner', expiresAt: future() },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'INV' }));
    expect(await r.json()).toEqual({ ok: true, alreadyMember: true });
    expect((store[INVITE] as { status?: string }).status).toBe('active');
    expect(store[USER]).toBeUndefined();
  });

  it('使用済み / status≠active は 400（会員化しない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [INVITE]: { status: 'used', usedBy: 'x', expiresAt: future() } }).db);
    expect((await POST(req({ code: 'INV' }))).status).toBe(400);

    const { db, store } = makeDb({ [INVITE]: { status: 'revoked', expiresAt: future() } });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req({ code: 'INV' }))).status).toBe(400);
    expect(store[USER]).toBeUndefined();
  });

  it('期限切れ（expiresAt が過去の Timestamp）は 400', async () => {
    const { db, store } = makeDb({ [INVITE]: { status: 'active', issuedBy: 'owner', expiresAt: past() } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ code: 'INV' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('期限切れ');
    expect(store[USER]).toBeUndefined();
  });

  it('expiresAt 欠落は防御的に非失効扱いで会員化（active かつ未使用なら通す）', async () => {
    const { db, store } = makeDb({ [INVITE]: { status: 'active', issuedBy: 'owner' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ code: 'INV' }));
    expect(r.status).toBe(200);
    expect(store[USER]).toBeDefined();
  });

  it('issuedBy が無ければ会員化するが通知はしない', async () => {
    const { db, store, added } = makeDb({ [INVITE]: { status: 'active', expiresAt: future() } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ code: 'INV' }));
    expect(r.status).toBe(200);
    expect(store[USER]).toBeDefined();
    expect(notifCount(added)).toBe(0);
  });
});
