import { describe, it, expect, beforeEach, vi } from 'vitest';

// referral/redeem の POST を Admin SDK モック＋フェイク Firestore で検証する（Day70）。
// 紹介コード使用は報酬付与（被招待者 +20cr / 招待者 +50cr）を伴うため、以下の
// セキュリティ不変条件をルート単体で固定する:
//   - 自分のコードは使えない（自己紹介による報酬荒稼ぎ防止）
//   - referredBy は 1 回限り（二重受領で報酬を複数回得られない）
//   - tryClaimMission への付与配線（誰にどのミッションを）
//   - v2(reward_) 優先・旧 crm_ 読みフォールバック

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), claim: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/missions/lib', () => ({ tryClaimMission: mocks.claim }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__ST__', delete: () => '__DEL__' },
}));

import { POST } from '../../src/app/api/referral/redeem/route';

/** 任意パスの doc を持つ最小フェイク Firestore（increment merge 対応・tx は単純適用） */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = JSON.parse(JSON.stringify(seed));
  const merge = (path: string, data: Record<string, unknown>) => {
    const cur = { ...(store[path] ?? {}) };
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && '__inc' in (v as Record<string, unknown>)) {
        cur[k] = (typeof cur[k] === 'number' ? (cur[k] as number) : 0) + (v as { __inc: number }).__inc;
      } else cur[k] = v;
    }
    store[path] = cur;
  };
  const snap = (path: string) => ({ exists: store[path] !== undefined, data: () => store[path] });
  const ref = (path: string) => ({ path, get: async () => snap(path), set: async (d: Record<string, unknown>) => merge(path, d) });
  const db = {
    doc: (path: string) => ref(path),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({ get: async (r: { path: string }) => snap(r.path), set: (r: { path: string }, d: Record<string, unknown>) => merge(r.path, d) }),
  };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;

describe('referral/redeem POST（報酬付与の安全境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('referee');
    mocks.getDb.mockReset();
    mocks.claim.mockReset().mockImplementation(async (_uid: string, missionId: string) => ({
      granted: missionId === 'invite_first_friend' ? 50 : 20,
      alreadyClaimed: false,
      missionId,
    }));
  });

  it('コードが短すぎ/空は 400（報酬付与に到達しない）', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ code: 'AB' }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('存在しないコード / ownerUid 欠落は 404', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ code: 'ABCD' }))).status).toBe(404);

    mocks.getDb.mockReturnValue(makeDb({ 'reward_referral_codes/ABCD': { usedCount: 0 } }).db);
    expect((await POST(req({ code: 'ABCD' }))).status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('🔐自分のコードは 400（自己紹介での報酬荒稼ぎ防止）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'reward_referral_codes/ABCD': { ownerUid: 'referee', usedCount: 0 } }).db);
    const r = await POST(req({ code: 'ABCD' }));
    expect(r.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('成功: referredBy を記録・usedCount++・両者へ正しいミッション付与（小文字入力も大文字化）', async () => {
    const { db, store } = makeDb({ 'reward_referral_codes/ABCD': { ownerUid: 'owner', usedCount: 2 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'abcd' })); // 小文字でも大文字化して解決
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, refereeCreditsGranted: 20, referrerCreditsGranted: 50 });
    expect((store['account_subscriptions/referee'] as { referredBy?: string }).referredBy).toBe('owner');
    expect((store['reward_referral_codes/ABCD'] as { usedCount?: number }).usedCount).toBe(3);
    // 被招待者=accept_referral、招待者=invite_first_friend
    expect(mocks.claim).toHaveBeenCalledWith('referee', 'accept_referral');
    expect(mocks.claim).toHaveBeenCalledWith('owner', 'invite_first_friend');
  });

  it('🔐既に referredBy 済み: 409 で拒否し、報酬も usedCount も動かさない（二重受領防止）', async () => {
    const { db, store } = makeDb({
      'reward_referral_codes/ABCD': { ownerUid: 'owner', usedCount: 2 },
      'account_subscriptions/referee': { referredBy: 'someone' },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'ABCD' }));
    expect(r.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect((store['reward_referral_codes/ABCD'] as { usedCount?: number }).usedCount).toBe(2); // 不変
    expect((store['account_subscriptions/referee'] as { referredBy?: string }).referredBy).toBe('someone'); // 上書きしない
  });

  it('旧 crm_ コードへ読みフォールバックし、その usedCount を increment', async () => {
    const { db, store } = makeDb({ 'crm_referral_codes/ABCD': { ownerUid: 'owner', usedCount: 7 } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ code: 'ABCD' }));
    expect(r.status).toBe(200);
    expect((store['crm_referral_codes/ABCD'] as { usedCount?: number }).usedCount).toBe(8);
    expect(mocks.claim).toHaveBeenCalledWith('referee', 'accept_referral');
  });
});
