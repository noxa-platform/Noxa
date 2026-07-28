import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/suggest の POST を Admin SDK モック＋LLM モックで検証する（Day88）。
// ログ入力後に「次のアクション」を提案する route（手動 reserve/refund＋PII ガード）。
//
// 実バグ修正（Day88）: 顧客ログの取得が orderBy('date') で、ContactLog は `date` フィールドを
// 持たない（正準は `datetime`）ため **recentLogs が常に空**になり AI が直近ログ無しで提案していた。
// sibling（message/customer-infer-profile/briefing/chat）と揃え orderBy('datetime') に是正。
// 本テストは (1) その回帰（orderBy フィールド）を固定し、(2) route の入力/認可/refund 境界を spec 化する。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), gen: vi.fn(),
  reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn(),
}));

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
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/suggest/route';

// orderBy に渡されたフィールドを記録するフェイク Firestore。
let orderByField: string | null = null;
function makeDb(customer: Record<string, unknown> | undefined, logs: Record<string, unknown>[] = []) {
  return {
    doc: () => ({ get: async () => ({ exists: customer !== undefined, data: () => customer }) }),
    collection: () => ({
      orderBy: (field: string) => {
        orderByField = field;
        return { limit: () => ({ get: async () => ({ docs: logs.map((l) => ({ data: () => l })) }) }) };
      },
    }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const okReserve = { ok: true, remaining: 8, total: 9, consumedMonthly: 1, consumedPurchased: 0 };
const okBody = { workspaceId: 'w1', customerId: 'c1', lastLogType: 'visit' };

describe('ai/suggest POST（次アクション提案）', () => {
  beforeEach(() => {
    orderByField = null;
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎' }, [{ type: 'visit', datetime: { seconds: 1 } }]));
    mocks.gen.mockReset().mockResolvedValue('{"nextAction":"連絡","timing":"3日後","reason":"維持"}');
    mocks.reserve.mockReset().mockResolvedValue(okReserve);
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
  });

  it('回帰: 顧客ログを orderBy("datetime") で取得する（date ではない）', async () => {
    await POST(req(okBody));
    expect(orderByField).toBe('datetime');
  });

  it('workspaceId / customerId 欠落は 400', async () => {
    expect((await POST(req({ customerId: 'c1' }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('クレジット不足（reserve.ok=false）は 429・generateText 未呼び出し', async () => {
    mocks.reserve.mockResolvedValue({ ...okReserve, ok: false, remaining: 0 });
    const res = await POST(req(okBody));
    expect(res.status).toBe(429);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('成功: suggestion をパースし creditsRemaining を返す・ledger 記録・refund なし', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestion: { nextAction: '連絡', timing: '3日後', reason: '維持' },
      creditsRemaining: 8,
    });
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('generateText 失敗時は refund してから 500', async () => {
    mocks.gen.mockRejectedValue(new Error('LLM down'));
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('非 JSON 応答は既定 suggestion にフォールバック', async () => {
    mocks.gen.mockResolvedValue('提案できません');
    const body = await (await POST(req(okBody))).json();
    expect(body.suggestion).toEqual({ nextAction: 'フォロー連絡', timing: '3日後', reason: '関係維持のため' });
  });
});
