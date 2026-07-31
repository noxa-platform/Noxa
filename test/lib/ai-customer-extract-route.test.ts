import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/customer-extract の POST を検証する（Day95-夜）。
// LINE トーク履歴などのテキストを貼り付けて顧客プロファイル候補を抽出する読み取り専用ルート
// （withReservedCredits＝canonical 引当）。Day92/93 の精査で実バグなしと判定済みの route を
// executable spec として固定する。固定する挙動:
//   - workspaceId 欠落 / text 非文字列・10 文字未満=400、1MB 超=413（いずれも reserve 前短絡）
//   - 認証失敗=401 / 越境（resolveAccessContext throw）=generic 500 かつ LLM 未呼び出し
//   - 成功: LLM の生 JSON を profile として返し ack（消費確定）
//   - **不正 JSON は refund せず ack**（`{notes: 生テキスト, name: null}` に詰めて返す）。
//     vision 系（profile-extract / customer-context-extract）と同じ「抽出系は空・生テキストでも
//     ユーザーに価値がある出力＝ack」設計で、構造化分析系（seating-suggest / insights-narrative /
//     insights）が parse 失敗で refund するのとは意図的に異なる（Day91/92/93 の判定）。
//   - hint は任意（渡せば本文に載る）

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), gen: vi.fn(), ack: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 3 }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 9 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/customer-extract/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const okText = 'たかし: 明日空いてる？\n自分: 空いてるよ〜！ゴルフの話またしたいな';
const okBody = { workspaceId: 'w1', text: okText };

describe('ai/customer-extract POST（テキスト→顧客プロファイル抽出）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 's1', uid: 'u1' });
    mocks.gen.mockReset().mockResolvedValue('{"name":"たかし","mbti":null,"interests":["ゴルフ"],"suggestedTags":["太客"]}');
    mocks.ack.mockReset();
  });

  it('workspaceId 欠落は 400（reserve 前短絡）', async () => {
    const res = await POST(req({ text: okText }));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('text 欠落・非文字列・10 文字未満は 400', async () => {
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', text: 12345 }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', text: '短い' }))).status).toBe(400);
    // 前後の空白は trim して数えるため、実質 9 文字は弾かれる
    expect((await POST(req({ workspaceId: 'w1', text: '  123456789  ' }))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('ちょうど 10 文字は通る（境界）', async () => {
    const res = await POST(req({ workspaceId: 'w1', text: '1234567890' }));
    expect(res.status).toBe(200);
    expect(mocks.gen).toHaveBeenCalledTimes(1);
  });

  it('1MB 超のテキストは 413（バイト長で判定・reserve 前）', async () => {
    // 3 バイト文字 × 350000 = 1.05MB
    const res = await POST(req({ workspaceId: 'w1', text: 'あ'.repeat(350_000) }));
    expect(res.status).toBe(413);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('越境（resolveAccessContext throw）は generic 500・LLM 未呼び出し', async () => {
    mocks.resolve.mockRejectedValue(new Error('workspace access denied'));
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('抽出に失敗しました');
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('成功: profile＋creditsRemaining を返し ack（消費確定）', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile).toEqual({ name: 'たかし', mbti: null, interests: ['ゴルフ'], suggestedTags: ['太客'] });
    expect(json.creditsRemaining).toBe(9);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
    // 解析対象テキストが本文に載る
    expect(String(mocks.gen.mock.calls[0][0])).toContain('ゴルフの話');
  });

  it('hint は任意（渡せば「## 補足」として本文に載る）', async () => {
    await POST(req(okBody));
    expect(String(mocks.gen.mock.calls[0][0])).not.toContain('## 補足');
    mocks.gen.mockClear();
    await POST(req({ ...okBody, hint: '2ヶ月分の履歴です' }));
    const body = String(mocks.gen.mock.calls[0][0]);
    expect(body).toContain('## 補足');
    expect(body).toContain('2ヶ月分の履歴です');
  });

  it('不正 JSON は notes に生テキストを詰めて 200＋ack（抽出系の ack ポリシー）', async () => {
    mocks.gen.mockResolvedValue('この履歴からは名前を特定できませんでした');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile).toEqual({ notes: 'この履歴からは名前を特定できませんでした', name: null });
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('生成が throw したら 500・ack しない（refund 契約）', async () => {
    mocks.gen.mockRejectedValue(new Error('LLM down'));
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
