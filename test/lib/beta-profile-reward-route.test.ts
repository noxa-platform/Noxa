import { describe, it, expect, beforeEach, vi } from 'vitest';

// account/beta-profile-reward（プロフィール全項埋め報酬の診断 GET / 受領 POST＝money 系）の
// characterization テスト（Day105・それまでゼロカバレッジ）。
// 固定する境界:
//   - 入力検証: workspaceId 必須＋doc ID として安全（`/` 入りのパス injection を弾く）
//   - context 解決: shop は shop_shops/{wid}/ai_profile/self、personal は personal_self_styles/{uid}
//   - 受領ガード: 全項埋めでなければ 400（未入力の先頭項目を返す）
//   - **二重受領の封鎖**: 旧実装の受領記録（account_subscriptions.betaProfileRewardClaimedAt）が
//     あれば reward_missions に無くても 409（移行時のバックフィルが無いため）
//   - 互換フィールドの書込失敗は 500 にしない（報酬は付与済みのため）
//   - 認証失敗 = 401

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  getDb: vi.fn(),
  claim: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '<serverTimestamp>' },
}));
vi.mock('../../src/app/api/missions/lib', () => ({ tryClaimMission: mocks.claim }));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { GET, POST } from '../../src/app/api/account/beta-profile-reward/route';

/** doc().get() / doc().set() 対応の最小フェイク（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}, failWrites: string[] = []) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const reads: string[] = [];
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  const db = {
    doc: (p: string) => {
      // Firestore の実挙動: doc パスはセグメント数が偶数でなければ throw
      if (p.split('/').length % 2 !== 0) throw new Error(`Invalid document path: ${p}`);
      return {
        get: async () => { reads.push(p); return { exists: store[p] !== undefined, data: () => store[p] }; },
        set: async (data: Record<string, unknown>) => {
          if (failWrites.includes(p)) throw new Error('write failed');
          store[p] = { ...(store[p] ?? {}), ...data };
          writes.push({ path: p, data });
        },
      };
    },
  };
  return { db, store, reads, writes };
}

const FULL_PROFILE = {
  stageName: 'あや', staffRole: 'キャスト', gender: 'female',
  firstPerson: 'わたし', defaultTone: 'やさしめ', emojiLevel: 'many',
};

const SHOP_SEED = {
  'shop_shops/s1': { ownerUid: 'u1' },
  'shop_shops/s1/ai_profile/self': { ...FULL_PROFILE },
};

const getReq = (wid: string | null) =>
  ({ nextUrl: { searchParams: { get: (k: string) => (k === 'workspaceId' ? wid : null) } } }) as never;
const postReq = (body: unknown) => ({ json: async () => body }) as never;
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue('u1');
  mocks.getDb.mockReset();
  mocks.claim.mockReset().mockResolvedValue({ granted: 10, alreadyClaimed: false, missionId: 'profile_complete' });
});

describe('beta-profile-reward GET（埋まり具合の診断）', () => {
  it('workspaceId 欠落は 400（DB に触れない）', async () => {
    const { db, reads } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    const res = await GET(getReq(null));
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('workspaceId に `/` を含むパス injection は 400（500 にしない）', async () => {
    const { db, reads } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    const res = await GET(getReq('s1/ai_profile'));
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('shop は ai_profile/self を読み、全項埋めなら allFilled=true・報酬額 10 を返す', async () => {
    const { db, reads } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    const body = await json(await GET(getReq('s1')));
    expect(reads).toContain('shop_shops/s1/ai_profile/self');
    expect(body.allFilled).toBe(true);
    expect(body.filledCount).toBe(6);
    expect(body.requiredCount).toBe(6);
    expect(body.rewardAmount).toBe(10);
    expect(body.claimed).toBe(false);
  });

  it('personal（workspaceId === uid）は personal_self_styles/{uid} を読む', async () => {
    const { db, reads } = makeDb({ 'personal_self_styles/u1': { stageName: 'あや' } });
    mocks.getDb.mockReturnValue(db);
    const body = await json(await GET(getReq('u1')));
    expect(reads).toContain('personal_self_styles/u1');
    expect(body.allFilled).toBe(false);
    expect(body.filledCount).toBe(1);
    expect((body.filled as Record<string, boolean>).staffRole).toBe(false);
  });

  it('プロフィール doc が無くても 200（全項目 false）', async () => {
    const { db } = makeDb({ 'shop_shops/s1': { ownerUid: 'u1' } });
    mocks.getDb.mockReturnValue(db);
    const body = await json(await GET(getReq('s1')));
    expect(body.allFilled).toBe(false);
    expect(body.filledCount).toBe(0);
  });

  it('reward_missions に受領記録があれば claimed=true・claimedAt を返す', async () => {
    const { db } = makeDb({ ...SHOP_SEED, 'reward_missions/u1': { claimed: { profile_complete: 'T1' } } });
    mocks.getDb.mockReturnValue(db);
    const body = await json(await GET(getReq('s1')));
    expect(body.claimed).toBe(true);
    expect(body.claimedAt).toBe('T1');
  });

  it('★旧実装の受領記録だけでも claimed=true（POST が 409 で弾く状態と表示を一致させる）', async () => {
    const { db } = makeDb({ ...SHOP_SEED, 'account_subscriptions/u1': { betaProfileRewardClaimedAt: 'T0' } });
    mocks.getDb.mockReturnValue(db);
    const body = await json(await GET(getReq('s1')));
    expect(body.claimed).toBe(true);
  });

  it('非メンバーの shop は 401（resolveAccessContext の AuthError）', async () => {
    mocks.verify.mockResolvedValue('other');
    const { db } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    expect((await GET(getReq('s1'))).status).toBe(401);
  });

  it('未認証は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('no token'));
    mocks.getDb.mockReturnValue(makeDb(SHOP_SEED).db);
    expect((await GET(getReq('s1'))).status).toBe(401);
  });
});

describe('beta-profile-reward POST（報酬の受領）', () => {
  it('workspaceId 欠落・非文字列・`/` 入りは 400（受領を試みない）', async () => {
    const { db } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    expect((await POST(postReq({}))).status).toBe(400);
    expect((await POST(postReq({ workspaceId: 123 }))).status).toBe(400);
    expect((await POST(postReq({ workspaceId: 's1/ai_profile' }))).status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('本文が JSON でなくても 400（throw させない）', async () => {
    const { db } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    const res = await POST({ json: async () => { throw new Error('bad json'); } } as never);
    expect(res.status).toBe(400);
  });

  it('全項埋めなら受領して granted を返し、互換フィールドを書く', async () => {
    const { db, writes } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    const res = await POST(postReq({ workspaceId: 's1' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, granted: 10 });
    expect(mocks.claim).toHaveBeenCalledWith('u1', 'profile_complete');
    expect(writes).toEqual([
      { path: 'account_subscriptions/u1', data: { betaProfileRewardClaimedAt: '<serverTimestamp>' } },
    ]);
  });

  it('1 項目でも空なら 400＋未入力の先頭項目を返し、受領を試みない', async () => {
    const { db } = makeDb({
      'shop_shops/s1': { ownerUid: 'u1' },
      'shop_shops/s1/ai_profile/self': { ...FULL_PROFILE, gender: '   ' },
    });
    mocks.getDb.mockReturnValue(db);
    const res = await POST(postReq({ workspaceId: 's1' }));
    expect(res.status).toBe(400);
    expect((await json(res)).missing).toBe('gender');
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('★旧実装で受領済み（betaProfileRewardClaimedAt あり）なら 409＝二重受領を封鎖', async () => {
    // reward_missions は空。ここを見ないと tryClaimMission が通って 10 クレジットが二重付与される
    const { db } = makeDb({ ...SHOP_SEED, 'account_subscriptions/u1': { betaProfileRewardClaimedAt: 'T0' } });
    mocks.getDb.mockReturnValue(db);
    const res = await POST(postReq({ workspaceId: 's1' }));
    expect(res.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('ミッション側が受領済みを返したら 409（冪等）', async () => {
    mocks.claim.mockResolvedValue({ granted: 0, alreadyClaimed: true, missionId: 'profile_complete' });
    const { db, writes } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    expect((await POST(postReq({ workspaceId: 's1' }))).status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it('互換フィールドの書込が失敗しても 200（報酬は付与済み＝エラーにすると行き止まりになる）', async () => {
    const { db } = makeDb(SHOP_SEED, ['account_subscriptions/u1']);
    mocks.getDb.mockReturnValue(db);
    const res = await POST(postReq({ workspaceId: 's1' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, granted: 10 });
  });

  it('付与そのものが失敗したら 500（握りつぶさない）', async () => {
    mocks.claim.mockRejectedValue(new Error('grant failed'));
    const { db } = makeDb(SHOP_SEED);
    mocks.getDb.mockReturnValue(db);
    expect((await POST(postReq({ workspaceId: 's1' }))).status).toBe(500);
  });

  it('personal は自分の uid のみ（他人の uid を workspaceId にすると 401）', async () => {
    const { db } = makeDb({ 'personal_self_styles/u2': { ...FULL_PROFILE } });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(postReq({ workspaceId: 'u2' }))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('未認証は 401（受領を試みない）', async () => {
    mocks.verify.mockRejectedValue(new AuthError('no token'));
    mocks.getDb.mockReturnValue(makeDb(SHOP_SEED).db);
    expect((await POST(postReq({ workspaceId: 's1' }))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
