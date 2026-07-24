import { describe, it, expect, beforeEach, vi } from 'vitest';

// missions/trigger の POST を Admin SDK モック＋フェイク Firestore で検証する（Day68）。
// このルートはクライアント申告のミッション達成をサーバ側で実データ検証する改ざん防止境界。
//
// 🐛 Day68 修正の回帰: first_log は「顧客の初ログ 1 件」で達成だが、旧実装は顧客取得を
//   limit(1)+slice(0,1) で先頭 1 件に絞っていたため、2 件目以降の顧客に付けた初ログを
//   取りこぼし誤って 400 で弾いていた。最大 5 顧客を横断確認するよう修正した。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), claim: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: async (uid: string) => ({ kind: 'personal', uid }),
  pathCustomers: (ctx: { uid: string }) => `personal_customers/${ctx.uid}/items`,
  pathCustomerLogs: (ctx: { uid: string }, cid: string) => `personal_customers/${ctx.uid}/items/${cid}/logs`,
}));
vi.mock('../../src/app/api/missions/lib', () => ({ tryClaimMission: mocks.claim }));

import { POST } from '../../src/app/api/missions/trigger/route';

/** customers（items）と各顧客の logs 有無だけを持つ最小フェイク Firestore。
 *  collection(path).limit(n).get() が {size, empty, docs:[{id}]} を返す。 */
function makeDb(customerIds: string[], logsByCustomer: Record<string, boolean> = {}) {
  return {
    collection: (path: string) => ({
      limit: (n: number) => ({
        get: async () => {
          if (path.endsWith('/items')) {
            const ids = customerIds.slice(0, n);
            return { size: ids.length, empty: ids.length === 0, docs: ids.map((id) => ({ id })) };
          }
          const m = path.match(/items\/([^/]+)\/logs$/);
          const cid = m?.[1] ?? '';
          const has = !!logsByCustomer[cid];
          return { size: has ? 1 : 0, empty: !has, docs: has ? [{ id: 'log1' }] : [] };
        },
      }),
    }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;

describe('missions/trigger POST（改ざん防止のサーバ検証）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
    mocks.claim.mockReset().mockImplementation(async (_uid: string, missionId: string) => ({
      granted: 5, alreadyClaimed: false, missionId,
    }));
  });

  it('missionId 未指定は 400', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('allowlist 外の missionId は 400（クライアントから受領不可）', async () => {
    // profile_complete はサーバ専用 route 経由でのみ受領可
    const r = await POST(req({ missionId: 'profile_complete', workspaceId: 'u1' }));
    expect(r.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('顧客系は workspaceId 必須（欠落で 400）', async () => {
    const r = await POST(req({ missionId: 'first_customer' }));
    expect(r.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('first_customer: 顧客 0 件なら 400、1 件以上で claim', async () => {
    mocks.getDb.mockReturnValue(makeDb([]));
    expect((await POST(req({ missionId: 'first_customer', workspaceId: 'u1' }))).status).toBe(400);

    mocks.getDb.mockReturnValue(makeDb(['c1']));
    const r = await POST(req({ missionId: 'first_customer', workspaceId: 'u1' }));
    expect(r.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith('u1', 'first_customer');
  });

  it('add_5_customers: 5 件未満は 400、5 件で claim', async () => {
    mocks.getDb.mockReturnValue(makeDb(['c1', 'c2', 'c3', 'c4']));
    expect((await POST(req({ missionId: 'add_5_customers', workspaceId: 'u1' }))).status).toBe(400);

    mocks.getDb.mockReturnValue(makeDb(['c1', 'c2', 'c3', 'c4', 'c5']));
    expect((await POST(req({ missionId: 'add_5_customers', workspaceId: 'u1' }))).status).toBe(200);
  });

  it('🐛回帰: first_log は先頭以外の顧客に付いた初ログでも達成できる（c2 のみログ→200）', async () => {
    mocks.getDb.mockReturnValue(makeDb(['c1', 'c2'], { c1: false, c2: true }));
    const r = await POST(req({ missionId: 'first_log', workspaceId: 'u1' }));
    expect(r.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith('u1', 'first_log');
  });

  it('first_log: どの顧客にもログが無ければ 400（誤付与しない）', async () => {
    mocks.getDb.mockReturnValue(makeDb(['c1', 'c2'], { c1: false, c2: false }));
    const r = await POST(req({ missionId: 'first_log', workspaceId: 'u1' }));
    expect(r.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('share_referral: 実データ検証なし（意思表示のみ）で即 claim', async () => {
    mocks.getDb.mockReturnValue(makeDb([])); // 参照されないはず
    const r = await POST(req({ missionId: 'share_referral' }));
    expect(r.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith('u1', 'share_referral');
  });
});
