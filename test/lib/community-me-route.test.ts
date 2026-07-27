import { describe, it, expect, beforeEach, vi } from 'vitest';

// community/me の POST を Admin SDK モック＋フェイク Firestore で検証する（Day82）。
// コミュニティのメンバーシップ状態を返す。固定する境界:
//   - isMember = admin もしくは noxa_users/{uid} 存在
//   - inviteCredits = admin は null（無制限）・会員は残クレジット・非会員は 0
//   - invitePrivilegeRevoked = noxa_users の当該フラグが true のときのみ true
//   - 認証失敗=401

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/community/me/route';

function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  return { db: { doc: (p: string) => ({ get: async () => ({ exists: store[p] !== undefined, data: () => store[p] }) }) } };
}
const req = () => ({ json: async () => ({}) }) as never;

describe('community/me POST（メンバーシップ状態）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
  });

  it('非会員: isMember=false・inviteCredits=0・revoked=false', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect(await (await POST(req())).json()).toEqual({
      isMember: false, isAdmin: false, inviteCredits: 0, invitePrivilegeRevoked: false,
    });
  });

  it('会員: 残クレジットと revoked フラグを返す', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'noxa_users/u1': { inviteCredits: 3, invitePrivilegeRevoked: false } }).db);
    expect(await (await POST(req())).json()).toEqual({
      isMember: true, isAdmin: false, inviteCredits: 3, invitePrivilegeRevoked: false,
    });
  });

  it('会員で inviteCredits 未設定は 0 / revoked=true を反映', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'noxa_users/u1': { invitePrivilegeRevoked: true } }).db);
    expect(await (await POST(req())).json()).toEqual({
      isMember: true, isAdmin: false, inviteCredits: 0, invitePrivilegeRevoked: true,
    });
  });

  it('admin: isMember=true・inviteCredits=null（noxa_users があっても無制限）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      'account_users/u1': { platformRole: 'admin' },
      'noxa_users/u1': { inviteCredits: 3 },
    }).db);
    expect(await (await POST(req())).json()).toEqual({
      isMember: true, isAdmin: true, inviteCredits: null, invitePrivilegeRevoked: false,
    });
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req())).status).toBe(401);
  });
});
