import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/message/reply の POST を検証する（Day89 PM・ai/message の直接 sibling）。
// スクショ画像から返信案3パターンを生成（FormData 入力・手動 reserve/refund）。
// Day89 の ai/message と同型の money 境界＋画像検証を固定する:
//   - workspaceId/customerId 欠落=400、画像0枚=400、4枚以上=400、5MB 超=400（いずれも reserve 前）
//   - クレジット不足=429（analyzeImages 未呼び出し）
//   - 顧客不在=refund してから 404（AI 未呼出なので課金しない）
//   - analyzeImages 失敗=refund してから throw（→500）
//   - 生成結果が空=refund してから 500、成功=replies＋creditsRemaining＋ledger（refund なし）
//   - 認証失敗=401
//
// 実バグは発見されず（feedback は createdAt/rating が書込側と一致・refund 4経路対称）。executable spec。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), analyze: vi.fn(),
  reserve: vi.fn(), refund: vi.fn(), ledger: vi.fn(),
  wsCtx: vi.fn(), compose: vi.fn(), selfBlock: vi.fn(), globalPat: vi.fn(), aggHint: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomer: () => 'customers/c1',
  pathCustomerSubcollection: () => 'customers/c1/ai_feedback',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ analyzeImages: mocks.analyze }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));
vi.mock('@/lib/ai-knowledge/prompt-helpers', () => ({
  resolveWorkspaceContext: mocks.wsCtx,
  composePlaybookAndSelf: mocks.compose,
  buildSelfBaseBlock: mocks.selfBlock,
}));
vi.mock('@/lib/ai-knowledge/global-patterns', () => ({
  getGlobalSuccessPatterns: mocks.globalPat,
  getAggregateHint: mocks.aggHint,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/message/reply/route';

function snap(rows: Record<string, unknown>[]) {
  const docs = rows.map((r) => ({ data: () => r }));
  return { docs, forEach: (fn: (d: { data: () => Record<string, unknown> }) => void) => docs.forEach(fn) };
}
function makeDb(customer: Record<string, unknown> | undefined, feedback: Record<string, unknown>[] = []) {
  return {
    doc: () => ({ get: async () => ({ exists: customer !== undefined, data: () => customer }) }),
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => snap(feedback) }) }) }),
  };
}

// 実 FormData + File で request を組む（route は entry instanceof File を見る）。
function makeReq(opts: { wid?: string; cid?: string; images?: File[]; scene?: string; customPrompt?: string }) {
  const fd = new FormData();
  if (opts.wid !== undefined) fd.set('workspaceId', opts.wid);
  if (opts.cid !== undefined) fd.set('customerId', opts.cid);
  if (opts.scene) fd.set('scene', opts.scene);
  if (opts.customPrompt) fd.set('customPrompt', opts.customPrompt);
  for (const f of opts.images ?? []) fd.append('images', f);
  return { formData: async () => fd } as never;
}
const img = (name = 'a.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const okReserve = { ok: true, remaining: 3, total: 4, consumedMonthly: 1, consumedPurchased: 0 };
const base = () => ({ wid: 'w1', cid: 'c1', images: [img()] });

describe('ai/message/reply POST（スクショ→返信案3生成）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎', chatHistory: [] }, []));
    mocks.analyze.mockReset().mockResolvedValue('["返信1","返信2","返信3"]');
    mocks.reserve.mockReset().mockResolvedValue(okReserve);
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset();
    mocks.wsCtx.mockReset().mockResolvedValue({ storeType: 'host', selfData: {}, storeProfile: {} });
    mocks.compose.mockReset().mockReturnValue({ playbookBlock: '', storeBlock: '' });
    mocks.selfBlock.mockReset().mockReturnValue('');
    mocks.globalPat.mockReset().mockResolvedValue([]);
    mocks.aggHint.mockReset().mockResolvedValue(null);
  });

  it('workspaceId/customerId 欠落は 400（reserve 前）', async () => {
    expect((await POST(makeReq({ cid: 'c1', images: [img()] }))).status).toBe(400);
    expect((await POST(makeReq({ wid: 'w1', images: [img()] }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(makeReq(base()))).status).toBe(401);
  });

  it('画像0枚は 400', async () => {
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1' }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('画像4枚以上は 400', async () => {
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1', images: [img(), img(), img(), img()] }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('5MB 超の画像は 400', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1', images: [big] }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('クレジット不足（reserve.ok=false）は 429・analyzeImages 未呼び出し', async () => {
    mocks.reserve.mockResolvedValue({ ...okReserve, ok: false, remaining: 0 });
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(429);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('顧客不在は refund してから 404', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined, []));
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(404);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('成功: replies＋creditsRemaining を返し ledger 記録・refund なし', async () => {
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replies: ['返信1', '返信2', '返信3'], creditsRemaining: 3 });
    expect(mocks.ledger).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('analyzeImages 失敗時は refund してから 500', async () => {
    mocks.analyze.mockRejectedValue(new Error('vision down'));
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('既知の scene は専用プロンプトが本文に載る（after_angry）', async () => {
    await POST(makeReq({ ...base(), scene: 'after_angry' }));
    const body = String(mocks.analyze.mock.calls[0][1]);
    expect(body).toContain('## シーン指定');
    expect(body).toContain('相手が怒っている');
  });

  // ▼ Day95-PM: insights と同型のプロトタイプチェーン索引バグ（SCENE_PROMPTS[scene]）。
  // 修正前は scene='constructor' が truthy になり Object 関数がシーン指定として送られた。
  it('scene がプロトタイプ由来のキー（constructor）でもシーン指定を足さない', async () => {
    const res = await POST(makeReq({ ...base(), scene: 'constructor' }));
    expect(res.status).toBe(200);
    const body = String(mocks.analyze.mock.calls[0][1]);
    expect(body).not.toContain('native code');
    expect(body).not.toContain('## シーン指定');
  });

  it('顧客の MBTI ヒントは既知キーのみ systemInstruction に載る（INTJ）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], mbti: 'INTJ' }, []));
    await POST(makeReq(base()));
    expect(String(mocks.analyze.mock.calls[0][2].systemInstruction)).toContain('INTJ — 論理的');
  });

  // mbtiHint の table[mbti] もプロトタイプ経由で解決していた（Day95-PM 同型5件目）。
  it('顧客の mbti がプロトタイプ由来のキー（constructor）でも関数が混入しない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], mbti: 'constructor' }, []));
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(200);
    const sys = String(mocks.analyze.mock.calls[0][2].systemInstruction);
    expect(sys).not.toContain('native code');
    expect(sys).toContain('## MBTI\nconstructor'); // 値そのものは出るがヒントは付かない
  });

  it('生成結果が空なら refund してから 500', async () => {
    mocks.analyze.mockResolvedValue('');
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });
});
