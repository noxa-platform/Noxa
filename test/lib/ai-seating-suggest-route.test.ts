import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/seating-suggest の POST を検証する（Day91）。
// 席回し盤面（卓×キャスト）＋自由要望から「理由つき配置提案」を JSON で返す
// 読み取り専用ルート（withReservedCredits＝canonical 引当）。固定する挙動:
//   - workspaceId 欠落=400 / tables・casts が配列でない=400（いずれも reserve 前短絡）
//   - 認証失敗（AuthError）=401
//   - personal ワークスペース（ctx.kind!=='shop'）=400（席回しは店舗専用）
//   - 盤面サイズ暴走（tables>60 / casts>200）=400
//   - 成功: LLM 生 JSON を proposals にパースして返し ack（=消費確定）
//   - **実バグ修正（Day91）**: 生成物が不正 JSON で提案を取り出せない場合は 500 かつ
//     **ack しない**（＝withReservedCredits が予約分を refund する Day67 契約）。
//     旧実装はこの経路でも ack して 200＋空 proposals を返し、失敗を成功に見せかけつつ課金していた。
//   - 正当な空提案（valid JSON の {proposals:[]}）は ack（消費確定）＝生成は成功しているため。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), gen: vi.fn(), ack: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 2 }));
// ack を spy で受け、生成失敗時に ack されない（=refund 契約）ことを検証する。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 9 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/seating-suggest/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = {
  workspaceId: 'w1',
  requestText: '新人を育てたい',
  tables: [{ id: 't1', name: 'A卓', type: 'box', status: 'seated', guests: 2, elapsedMin: 30, currentHosts: [], requested: [], excluded: [] }],
  casts: [{ id: 'c1', name: 'あや', rank: 'レギュラー', status: 'Working', isLocked: false }],
};

describe('ai/seating-suggest POST（AI 席回し提案）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', workspaceId: 'w1' });
    mocks.gen.mockReset().mockResolvedValue('{"proposals":[{"tableId":"t1","action":"assign","castIds":["c1"],"reason":"育成ペア"}],"note":"全体OK"}');
    mocks.ack.mockReset();
  });

  it('workspaceId 欠落は 400（reserve 前短絡）', async () => {
    const res = await POST(req({ tables: [], casts: [] }));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('tables/casts が配列でないと 400', async () => {
    expect((await POST(req({ workspaceId: 'w1', tables: [], casts: null }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', tables: 'x', casts: [] }))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('personal ワークスペース（kind!=="shop"）は 400', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'personal', uid: 'u1' });
    const res = await POST(req(okBody));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('盤面サイズ暴走（tables>60 / casts>200）は 400', async () => {
    const big = { ...okBody, tables: Array.from({ length: 61 }, (_, i) => ({ id: `t${i}` })) };
    expect((await POST(req(big))).status).toBe(400);
    const bigCasts = { ...okBody, casts: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}` })) };
    expect((await POST(req(bigCasts))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('成功: proposals をパースして返し ack（消費確定）する', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.proposals).toEqual([{ tableId: 't1', action: 'assign', castIds: ['c1'], reason: '育成ペア' }]);
    expect(json.note).toBe('全体OK');
    expect(json.creditsRemaining).toBe(9);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('コードフェンス混じり（生 JSON でない）でも {…} 抽出でパースし ack', async () => {
    mocks.gen.mockResolvedValue('```json\n{"proposals":[],"note":"移動不要"}\n```');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBe('移動不要');
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('正当な空提案（valid JSON の {proposals:[]}）は ack（消費確定）', async () => {
    mocks.gen.mockResolvedValue('{"proposals":[]}');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).proposals).toEqual([]);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  // ▼ Day91 実バグ修正の核: 不正 JSON（提案を取り出せない）は refund して 500。
  it('不正 JSON（非 JSON テキスト）は 500・ack しない（refund 契約）', async () => {
    mocks.gen.mockResolvedValue('提案できませんでした（JSONではない説明文）');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('JSON リテラル null/数値も生成失敗として 500・ack しない', async () => {
    mocks.gen.mockResolvedValue('null');
    expect((await POST(req(okBody))).status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
    mocks.ack.mockReset();
    mocks.gen.mockResolvedValue('123');
    expect((await POST(req(okBody))).status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
