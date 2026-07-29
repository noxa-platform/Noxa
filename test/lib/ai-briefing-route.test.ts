import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/briefing の POST を検証する（Day90）。
// 顧客1人を30秒で再把握する AI サマリ（withReservedCredits＝canonical 引当）。固定する挙動:
//   - workspaceId/customerId 欠落=400、認証401、越境（resolveAccessContext throw）=generic 500
//   - 成功: LLM 生 JSON をパースして briefing＋creditsRemaining を返し ack（=消費確定）
//   - パース失敗=500 かつ **ack しない**（＝withReservedCredits が refund する Day67 契約）
//   - 顧客不在でも context='{}' で生成継続（404 にしない設計）
//
// 顧客ログ orderBy は datetime（Day88 で正準確認済み）。実バグは発見されず。executable spec。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), gen: vi.fn(), ack: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomer: () => 'customers/c1',
  pathCustomerLogs: () => 'customers/c1/logs',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
// ack を spy で受けてパース失敗時に ack されない（=refund 契約）ことを検証する。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 6 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/briefing/route';

function makeDb(customer: Record<string, unknown> | undefined, logs: Record<string, unknown>[] = []) {
  return {
    doc: () => ({ get: async () => ({ exists: customer !== undefined, data: () => customer }) }),
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: logs.map((l) => ({ data: () => l })) }) }) }) }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = { workspaceId: 'w1', customerId: 'c1' };

describe('ai/briefing POST（会話前ブリーフィング）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎', rank: 'VIP' }, [{ type: 'visit', datetime: { toDate: () => new Date('2026-07-01') } }]));
    mocks.gen.mockReset().mockResolvedValue('{"stage":"S3","topicCandidates":["旅行","猫","映画"]}');
    mocks.ack.mockReset();
  });

  it('workspaceId/customerId 欠落は 400', async () => {
    expect((await POST(req({ customerId: 'c1' }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('越境（resolveAccessContext throw）は generic 500・LLM 未呼び出し', async () => {
    mocks.resolve.mockRejectedValue(new Error('forbidden'));
    const res = await POST(req({ workspaceId: 'other', customerId: 'c1' }));
    expect(res.status).toBe(500);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('成功: briefing をパースして返し ack（消費確定）する', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      briefing: { stage: 'S3', topicCandidates: ['旅行', '猫', '映画'] },
      creditsRemaining: 6,
    });
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('パース失敗は 500・ack しない（refund 契約）', async () => {
    mocks.gen.mockResolvedValue('JSONではない説明文');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('顧客不在でも context={} で生成継続（404 にしない）', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined, []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(mocks.gen).toHaveBeenCalledTimes(1);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });
});
