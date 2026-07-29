import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/insights-narrative の POST を検証する（Day92）。
// /insights のセグメント分布（クライアント計算済み）を AI で解説＋次の1手2件に絞る
// 読み取り専用ルート（withReservedCredits＝canonical 引当）。固定する挙動:
//   - workspaceId 欠落=400 / segmentCounts 欠落・非object=400（いずれも reserve 前短絡）
//   - 認証失敗（AuthError）=401
//   - 成功: LLM 生 JSON を summary/actions にパースして返し ack（=消費確定）
//   - コードフェンス混じり（生 JSON でない）でも {…} 抽出でパース＋ack
//   - **実バグ修正（Day92・seating-suggest Day91 の同型 sibling）**: 生成物が不正 JSON で
//     summary/actions を取り出せない場合は 500 かつ **ack しない**（＝withReservedCredits が
//     予約分を refund する Day67 契約）。旧実装は ack して 200＋空 summary/actions を返し、
//     失敗を成功に見せかけつつ課金していた（SYSTEM は summary 必須・actions 最低1個を要求する
//     ため、空 summary/actions は正当な出力になり得ず＝parse 失敗時のみ発生する）。

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
// 店舗/自分プロファイル合成はプロンプト装飾のみ（本テストの対象外）なので固定モック。
vi.mock('@/lib/ai-knowledge/prompt-helpers', () => ({
  resolveWorkspaceContext: async () => ({ storeType: 'club', selfData: null, storeProfile: null }),
  composePlaybookAndSelf: () => ({ combined: '' }),
}));
// ack を spy で受け、生成失敗時に ack されない（=refund 契約）ことを検証する。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 7 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/insights-narrative/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = {
  workspaceId: 'w1',
  segmentCounts: { vip: 3, needs_follow: 2, growing: 4, new_or_dormant: 1 },
  trendSummary: { increasing: 2, stable: 5, decreasing: 1 },
  sampleNames: { vip: ['あや', 'みく'] },
};

describe('ai/insights-narrative POST（セグメント解説＋次の1手）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.gen.mockReset().mockResolvedValue('{"summary":"VIP が増加傾向","actions":[{"title":"VIPへ来店誘導","reason":"来店周期が空いている"}]}');
    mocks.ack.mockReset();
  });

  it('workspaceId 欠落は 400（reserve 前短絡）', async () => {
    const res = await POST(req({ segmentCounts: okBody.segmentCounts }));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('segmentCounts 欠落・非object は 400（body.segmentCounts.vip 参照前に弾く）', async () => {
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', segmentCounts: 'x' }))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('成功: summary/actions をパースして返し ack（消費確定）する', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toBe('VIP が増加傾向');
    expect(json.actions).toEqual([{ title: 'VIPへ来店誘導', reason: '来店周期が空いている' }]);
    expect(json.creditsRemaining).toBe(7);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('コードフェンス混じりでも {…} 抽出でパースし ack', async () => {
    mocks.gen.mockResolvedValue('```json\n{"summary":"横ばい","actions":[{"title":"育成中をフォロー","reason":"伸びしろ"}]}\n```');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).summary).toBe('横ばい');
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('trendSummary/sampleNames 無しでも成功（任意フィールド）', async () => {
    const res = await POST(req({ workspaceId: 'w1', segmentCounts: okBody.segmentCounts }));
    expect(res.status).toBe(200);
    expect(mocks.gen).toHaveBeenCalledTimes(1);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  // ▼ Day92 実バグ修正の核: 不正 JSON（summary/actions を取り出せない）は refund して 500。
  it('不正 JSON（非 JSON テキスト）は 500・ack しない（refund 契約）', async () => {
    mocks.gen.mockResolvedValue('解説を生成できませんでした（JSONではない説明文）');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('JSON リテラル null/数値も生成失敗として 500・ack しない', async () => {
    mocks.gen.mockResolvedValue('null');
    expect((await POST(req(okBody))).status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
    mocks.ack.mockReset();
    mocks.gen.mockResolvedValue('42');
    expect((await POST(req(okBody))).status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
