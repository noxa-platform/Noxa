import { describe, it, expect, beforeEach, vi } from 'vitest';

// account/delete の POST を Admin SDK モック＋フェイク Firestore で検証する（Day80）。
// 退会は破壊的かつ PII/課金の後始末を伴うため、以下の不変条件をルート単体で固定する:
//   - token の uid のみを削除（body に uid を取らない＝IDOR 無し・他ユーザーの doc は不変）
//   - handle は account_users 削除前に読み、profile_pages/{handle} を削除（handle 無しは触らない）
//   - 主要 doc（account_users/subscriptions/google_tokens/push_tokens）＋ai_usage サブコレクション削除
//   - personal_reminders は ownerUid==uid のみ削除（他人の reminder は残す）
//   - ワークスペース: member doc は削除、owner なら WS doc も削除・非 owner は WS を残す
//   - Auth の deleteUser(uid) を呼ぶ / 認証失敗は 401

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), getAuth: vi.fn(), deleteUser: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  getAdminAuth: mocks.getAuth,
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/account/delete/route';

/** doc get/delete・collection get/where・batch delete 対応の最小フェイク Firestore（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const del = (p: string) => { delete store[p]; };
  const ref = (p: string) => ({ path: p, delete: async () => del(p) });
  const snap = (p: string) => ({ exists: store[p] !== undefined, ref: ref(p), data: () => store[p] });
  // collPath 直下の doc（セグメントがちょうど1つ多い）を列挙
  const collDocs = (collPath: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(collPath + '/') && !k.slice(collPath.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(collPath.length + 1), ref: ref(k), data: () => store[k] }));
  const makeColl = (collPath: string) => ({
    get: async () => ({ docs: collDocs(collPath) }),
    where: (field: string, _op: string, val: unknown) => ({
      get: async () => ({ docs: collDocs(collPath).filter((d) => store[d.ref.path]?.[field] === val) }),
    }),
  });
  const db = {
    doc: (p: string) => ({ path: p, get: async () => snap(p), delete: async () => del(p) }),
    collection: (p: string) => makeColl(p),
    batch: () => {
      const ops: string[] = [];
      return { delete: (r: { path: string }) => ops.push(r.path), commit: async () => ops.forEach(del) };
    },
  };
  return { db, store };
}
const req = () => ({}) as never;

describe('account/delete POST（退会の破壊的後始末の境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
    mocks.deleteUser.mockReset().mockResolvedValue(undefined);
    mocks.getAuth.mockReset().mockReturnValue({ deleteUser: mocks.deleteUser });
  });

  it('認証失敗（AuthError）は 401・削除しない', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    const { db, store } = makeDb({ 'account_users/u1': { handle: 'me' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req());
    expect(r.status).toBe(401);
    expect(store['account_users/u1']).toBeDefined();      // 不変
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('非 owner メンバー: 自分のデータのみ削除・WS は残す・他人の doc は不変', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'myhandle' },
      'profile_pages/myhandle': { uid: 'u1' },
      'account_subscriptions/u1': { purchasedCredits: 10 },
      'account_google_tokens/u1': { token: 'x' },
      'notification_push_tokens/u1': { token: 'y' },
      'account_ai_usage/u1': { total: 1 },
      'account_ai_usage/u1/monthly/2026-07': { used: 3 },
      'personal_reminders/rem1': { ownerUid: 'u1' },
      'personal_reminders/rem2': { ownerUid: 'other' }, // 他人の reminder
      'shop_shops/ws2': { ownerUid: 'boss' },            // u1 は非 owner
      'shop_shops/ws2/members/u1': { role: 'cast' },
      // 他ユーザーの account（IDOR で消えないこと）
      'account_users/u2': { handle: 'other' },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    expect(await r.json()).toEqual({ success: true });

    // 自分のデータは消える
    for (const p of [
      'account_users/u1', 'profile_pages/myhandle', 'account_subscriptions/u1',
      'account_google_tokens/u1', 'notification_push_tokens/u1',
      'account_ai_usage/u1', 'account_ai_usage/u1/monthly/2026-07',
      'personal_reminders/rem1', 'shop_shops/ws2/members/u1',
    ]) expect(store[p]).toBeUndefined();

    // 他人・WS 本体は残る
    expect(store['personal_reminders/rem2']).toBeDefined(); // 他人の reminder
    expect(store['shop_shops/ws2']).toBeDefined();          // 非 owner なので WS は残す
    expect(store['account_users/u2']).toBeDefined();        // IDOR 無し

    expect(mocks.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('owner: ワークスペース doc も member doc も削除する', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'owner1' },
      'shop_shops/ws1': { ownerUid: 'u1' },
      'shop_shops/ws1/members/u1': { role: 'owner' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['shop_shops/ws1']).toBeUndefined();          // owner は WS も削除
    expect(store['shop_shops/ws1/members/u1']).toBeUndefined();
  });

  it('handle が無ければ profile_pages を触らない', async () => {
    const { db, store } = makeDb({
      'account_users/u1': {},                 // handle 無し
      'profile_pages/someoneelse': { uid: 'zzz' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['account_users/u1']).toBeUndefined();       // 本体は削除
    expect(store['profile_pages/someoneelse']).toBeDefined(); // 無関係ページは不変
    expect(mocks.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('member でない WS は何も削除しない', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'h' },
      'shop_shops/wsX': { ownerUid: 'other' }, // u1 は member 不在
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['shop_shops/wsX']).toBeDefined(); // 非メンバーの WS は不変
  });
});
