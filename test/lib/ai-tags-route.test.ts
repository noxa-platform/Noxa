import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/tags の POST を LLM モック＋クレジットモックで検証する（Day85 PM・sibling 横断）。
// ai/parse（Day85）の同型 route。ただし引当は canonical withReservedCredits ではなく
// 手動 reserveAiCredit / refundAiCredit / logAiLedger 方式。その対称性を固定する:
//   - customerName 欠落=400（reserve 前に短絡）
//   - クレジット不足（reserve.ok=false）=429（generateText 未呼び出し・残高/必要数を返す）
//   - generateText 成功→ledger 記録＋tags 返却（refund は呼ばない＝消費確定）
//   - generateText 失敗→refund してから throw（500・確保分を必ず戻す）
//   - LLM 出力: JSON 配列はそのまま／非配列は []／非JSON はカンマ分割フォールバック
//   - 認証失敗=401
//
// 実バグは発見されず（refund 対称性は健全）。本テストは executable spec（プロダクトコード不変）。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), gen: vi.fn(), reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/tags/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const okReserve = { ok: true, remaining: 5, total: 6, consumedMonthly: 1, consumedPurchased: 0 };

describe('ai/tags POST（自動タグ付け・手動 reserve/refund 境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.gen.mockReset().mockResolvedValue('["お酒好き","話し上手"]');
    mocks.reserve.mockReset().mockResolvedValue(okReserve);
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
  });

  it('customerName 欠落は 400（reserve 前に短絡）', async () => {
    const res = await POST(req({ logs: [] }));
    expect(res.status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req({ customerName: 'A' }))).status).toBe(401);
  });

  it('クレジット不足（reserve.ok=false）は 429・generateText 未呼び出し', async () => {
    mocks.reserve.mockResolvedValue({ ...okReserve, ok: false, remaining: 0 });
    const res = await POST(req({ customerName: 'A' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.creditsRemaining).toBe(0);
    expect(body.requiredCredits).toBeGreaterThan(0);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('成功: JSON 配列をそのまま返し ledger 記録・refund は呼ばない', async () => {
    const res = await POST(req({ customerName: 'A', logs: [{ type: '来店', memo: 'シャンパン' }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ['お酒好き', '話し上手'], creditsRemaining: 5 });
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('generateText 失敗時は refund してから 500（確保分を戻す）', async () => {
    mocks.gen.mockRejectedValue(new Error('LLM down'));
    const res = await POST(req({ customerName: 'A' }));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('非配列 JSON（オブジェクト）は tags=[] に丸める', async () => {
    mocks.gen.mockResolvedValue('{"not":"array"}');
    expect((await (await POST(req({ customerName: 'A' }))).json()).tags).toEqual([]);
  });

  it('非 JSON 応答はカンマ分割フォールバック（括弧/引用符を除去）', async () => {
    mocks.gen.mockResolvedValue('["お酒好き", 話し上手, シャンパン派]');
    const body = await (await POST(req({ customerName: 'A' }))).json();
    expect(body.tags).toEqual(['お酒好き', '話し上手', 'シャンパン派']);
  });
});
