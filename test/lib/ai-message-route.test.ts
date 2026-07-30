import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/message の POST を Admin SDK モック＋LLM モックで検証する（Day89）。
// 顧客データ＋最新ログ＋👍👎フィードバック＋匿名化グローバルパターンからLINEメッセージ3案を生成。
// 手動 reserve/refund の money 境界（3つの返還経路）を固定する:
//   - wid/customerId 欠落=400（reserve 前短絡）
//   - クレジット不足=429（generateText 未呼び出し）
//   - 成功=messages 配列＋creditsRemaining＋ledger 記録（refund なし）
//   - generateText 失敗=refund してから 500（予約後〜モデル呼出の穴を塞ぐ Day28 型ガード）
//   - 生成結果が空配列/非配列/空白=refund してから 500（ledger 記録しない）
//   - 認証失敗=401
//
// 実バグは発見されず（顧客ログ orderBy は Day88 で datetime 確認済み・feedback は createdAt/rating が
// 書き込み側 ai/feedback と一致・refund 対称）。本テストは executable spec（プロダクトコード不変）。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), gen: vi.fn(),
  reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn(),
  wsCtx: vi.fn(), compose: vi.fn(), globalPat: vi.fn(), aggHint: vi.fn(),
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
  pathAiFeedback: () => 'customers/c1/ai_feedback',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));
vi.mock('@/lib/ai-knowledge/prompt-helpers', () => ({
  resolveWorkspaceContext: mocks.wsCtx,
  composePlaybookAndSelf: mocks.compose,
}));
vi.mock('@/lib/ai-knowledge/global-patterns', () => ({
  getGlobalSuccessPatterns: mocks.globalPat,
  getAggregateHint: mocks.aggHint,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/message/route';

function snap(rows: Record<string, unknown>[]) {
  const docs = rows.map((r) => ({ data: () => r }));
  return { docs, forEach: (fn: (d: { data: () => Record<string, unknown> }) => void) => docs.forEach(fn) };
}
// orderBy フィールドで logs(datetime) と feedback(createdAt) を出し分けるフェイク Firestore。
function makeDb(customer: Record<string, unknown> | undefined, logs: Record<string, unknown>[] = [], feedback: Record<string, unknown>[] = []) {
  return {
    doc: () => ({ get: async () => ({ exists: customer !== undefined, data: () => customer }) }),
    collection: () => ({
      orderBy: (field: string) => ({
        limit: () => ({ get: async () => (field === 'datetime' ? snap(logs) : snap(feedback)) }),
      }),
    }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const okReserve = { ok: true, remaining: 4, total: 5, consumedMonthly: 1, consumedPurchased: 0 };
const okBody = { wid: 'w1', customerId: 'c1', purpose: 'thank_you' };

describe('ai/message POST（LINE メッセージ3案生成）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎', mbti: 'INTJ' }, [{ type: 'visit', datetime: { toDate: () => new Date('2026-07-01') } }], []));
    mocks.gen.mockReset().mockResolvedValue('["案1","案2","案3"]');
    mocks.reserve.mockReset().mockResolvedValue(okReserve);
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
    mocks.wsCtx.mockReset().mockResolvedValue({ storeType: 'host', selfData: {}, storeProfile: {} });
    mocks.compose.mockReset().mockReturnValue({ playbookBlock: '', selfBlock: '', storeBlock: '' });
    mocks.globalPat.mockReset().mockResolvedValue([]);
    mocks.aggHint.mockReset().mockResolvedValue(null);
  });

  it('wid / customerId 欠落は 400（reserve 前短絡）', async () => {
    expect((await POST(req({ customerId: 'c1' }))).status).toBe(400);
    expect((await POST(req({ wid: 'w1' }))).status).toBe(400);
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

  it('成功: messages 3案＋creditsRemaining を返し ledger 記録・refund なし', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: ['案1', '案2', '案3'], creditsRemaining: 4 });
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

  it('空配列応答は refund してから 500（ledger なし）', async () => {
    mocks.gen.mockResolvedValue('[]');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('非配列 JSON（オブジェクト）は空扱いで refund＋500', async () => {
    mocks.gen.mockResolvedValue('{"a":1}');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it('非 JSON 応答は単一メッセージとして成功扱い', async () => {
    mocks.gen.mockResolvedValue('お礼メッセージ本文');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toEqual(['お礼メッセージ本文']);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('purpose は既知キーのみ指示文になり scene も対応付く（thank_you→first_contact）', async () => {
    await POST(req(okBody));
    expect(String(mocks.gen.mock.calls[0][0])).toContain('来店のお礼メッセージ');
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ scene: 'first_contact' }));
  });

  // ▼ Day95-PM: insights と同型のプロトタイプチェーン索引バグ（PURPOSE_PROMPTS / purposeToScene）。
  // 修正前は purpose='constructor' で Object 関数が「メッセージの目的」として AI に送られ課金だけ発生した。
  it('purpose がプロトタイプ由来のキー（constructor）でも関数が混入せず scene も null', async () => {
    const res = await POST(req({ wid: 'w1', customerId: 'c1', purpose: 'constructor' }));
    expect(res.status).toBe(200);
    expect(String(mocks.gen.mock.calls[0][0])).not.toContain('native code');
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ scene: null }));
    expect(mocks.globalPat).toHaveBeenCalledWith(expect.objectContaining({ scene: null }));
  });

  it('顧客の MBTI ヒントは既知キーのみ本文に載る（INTJ）', async () => {
    await POST(req(okBody));
    expect(String(mocks.gen.mock.calls[0][0])).toContain('MBTI接客ヒント: INTJ');
  });

  it('顧客の mbti がプロトタイプ由来のキー（constructor）でも関数が混入しない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', mbti: 'constructor' }, [], []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const body = String(mocks.gen.mock.calls[0][0]);
    expect(body).not.toContain('native code');
    expect(body).not.toContain('MBTI接客ヒント');
  });

  it('未知の purpose は目的なしで生成（既存挙動・scene も null）', async () => {
    const res = await POST(req({ wid: 'w1', customerId: 'c1', purpose: 'unknown_purpose' }));
    expect(res.status).toBe(200);
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ scene: null }));
  });

  it('👍👎フィードバックを rating 符号で good/bad に振り分けても正常生成', async () => {
    mocks.getDb.mockReturnValue(makeDb(
      { name: '太郎' },
      [],
      [{ output: '好評だった返信', rating: 1 }, { output: '不評だった返信', rating: -1 }],
    ));
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(3);
  });
});
