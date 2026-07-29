import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/customer-context-extract の POST を検証する（Day93）。
// 顧客との LINE/DM スクショから「相手（顧客）」の情報を抽出し顧客カルテ候補を返す
// vision 抽出ルート（withReservedCredits＝canonical 引当・analyzeImages）。固定する挙動:
//   - workspaceId 欠落 / images 非配列・空 = 400、images>4 = 400（いずれも reserve 前短絡）
//   - 認証失敗（AuthError）= 401
//   - 成功: LLM 生 JSON を extracted に正規化して返し ack（=消費確定）
//     - mood は positive/neutral/negative 以外を null に落とす
//     - 配列フィールドはモデルが文字列で返しても [、,\n] 区切りで配列化（arrayOrEmpty）
//     - hasContent は 1 フィールドでも非空なら true
//     - matchKnownCustomers: nameHint と name/nameKana の部分一致（双方向）で候補 id を最大5件返す
//   - **設計（Day92/93 で判定）**: 生成物が不正 JSON でも extracted 全空・hasContent=false を
//     正直に返して ack（＝スクショに顧客情報なしの正当結果と同型・vision 抽出は空が正当な出力に
//     なり得るため直接 sibling profile-extract と一貫。構造化入力の seating-suggest/insights-narrative
//     が parse 失敗で refund するのとは設計が異なる＝実バグではない）。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), analyze: vi.fn(), ack: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ analyzeImages: mocks.analyze }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 3 }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 5 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/customer-context-extract/route';

const img = { data: 'BASE64', mimeType: 'image/png' };
const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = { workspaceId: 'w1', images: [img] };

describe('ai/customer-context-extract POST（スクショ→顧客情報抽出）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.analyze.mockReset().mockResolvedValue(
      '{"nameHint":"たかし","mood":"positive","topics":["旅行","猫"],"likes":["日本酒"],"communicationStyle":"絵文字多め","notes":"誕生日近い"}',
    );
    mocks.ack.mockReset();
  });

  it('workspaceId 欠落 / images 非配列・空は 400（reserve 前短絡）', async () => {
    expect((await POST(req({ images: [img] }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', images: [] }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', images: 'x' }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('images 5 枚以上は 400', async () => {
    const res = await POST(req({ workspaceId: 'w1', images: [img, img, img, img, img] }));
    expect(res.status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('成功: extracted を正規化して返し ack（消費確定）する', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasContent).toBe(true);
    expect(json.extracted.nameHint).toBe('たかし');
    expect(json.extracted.mood).toBe('positive');
    expect(json.extracted.topics).toEqual(['旅行', '猫']);
    expect(json.extracted.communicationStyle).toBe('絵文字多め');
    expect(json.notes).toBe('誕生日近い');
    expect(json.creditsRemaining).toBe(5);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('mood は positive/neutral/negative 以外を null に落とす', async () => {
    mocks.analyze.mockResolvedValue('{"nameHint":"みく","mood":"ハッピー","topics":[]}');
    const json = await (await POST(req(okBody))).json();
    expect(json.extracted.mood).toBeNull();
  });

  it('配列フィールドをモデルが文字列で返しても区切りで配列化する（arrayOrEmpty）', async () => {
    mocks.analyze.mockResolvedValue('{"topics":"旅行、猫,映画","likes":"　"}');
    const json = await (await POST(req(okBody))).json();
    expect(json.extracted.topics).toEqual(['旅行', '猫', '映画']);
    expect(json.extracted.likes).toEqual([]); // 空白のみは除去
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('matchKnownCustomers: nameHint と name/nameKana の部分一致で候補 id を返す', async () => {
    mocks.analyze.mockResolvedValue('{"nameHint":"たか"}');
    const body = {
      workspaceId: 'w1',
      images: [img],
      knownCustomers: [
        { id: 'c1', name: 'たかし' }, // name.includes('たか')
        { id: 'c2', name: 'みく', nameKana: 'たか' }, // nameKana 一致
        { id: 'c3', name: '別人' },
      ],
    };
    const json = await (await POST(req(body))).json();
    expect(json.matchedCustomerIds.sort()).toEqual(['c1', 'c2']);
  });

  it('コードフェンス混じり（生 JSON でない）でも {…} 抽出でパースし ack', async () => {
    mocks.analyze.mockResolvedValue('```json\n{"nameHint":"れん","mood":"neutral"}\n```');
    const json = await (await POST(req(okBody))).json();
    expect(json.extracted.nameHint).toBe('れん');
    expect(json.extracted.mood).toBe('neutral');
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  // ▼ vision 抽出の設計: 不正 JSON でも hasContent=false を正直に返して ack（＝空が正当な結果）。
  //   直接 sibling profile-extract と一貫。seating-suggest/insights-narrative の refund 契約とは別設計。
  it('不正 JSON（非 JSON テキスト）でも hasContent=false・extracted 全空で 200＋ack', async () => {
    mocks.analyze.mockResolvedValue('画像に顧客情報はありませんでした（JSONではない）');
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasContent).toBe(false);
    expect(json.extracted.nameHint).toBeNull();
    expect(json.extracted.topics).toEqual([]);
    expect(json.matchedCustomerIds).toEqual([]);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });
});
