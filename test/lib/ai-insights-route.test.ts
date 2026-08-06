import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/insights の POST を検証する（Day95）。
// 顧客台帳を丸ごと読んで AI に分析させる読み取り専用ルート。**手動 reserve/refund 方式**
// （withReservedCredits を使わず reserveAiCredit → 失敗時 refundAiCredit）で、
// insights-narrative（Day92）と同じ「構造化分析系は parse 失敗で refund」契約を持つ。
// 固定する挙動:
//   - workspaceId 欠落=400（reserve 前短絡）/ 認証失敗=401 / クレジット不足=429
//   - type で読むデータ源が変わる（relationship_risk は chatHistory の mood 集計）
//   - 成功: JSON パースして data で返し ledger 記録（refund しない）
//   - 生成 throw / 不正 JSON は refund して 500（Day67 契約）
//   - Firestore 取得失敗は '[]' フォールバックで 500 にしない
//   - **実バグ修正（Day95）**: type / mood がプロトタイプ由来のキー（'constructor' 等）でも
//     壊れない。修正前は ①prompts['constructor'] が Object 関数に解決し
//     「function Object() { [native code] }」を指示文として AI へ送って課金 ②moodCounts に
//     NaN の余計なキーが生えて分析データに混入していた。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  gen: vi.fn(),
  reserve: vi.fn(),
  refund: vi.fn(),
  ledger: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
  getAdminDb: () => ({ collection: () => ({ get: mocks.get }) }),
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomers: () => 'shop_shops/s1/customers',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 5 }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/insights/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const snap = (docs: Record<string, unknown>[]) => ({
  empty: docs.length === 0,
  docs: docs.map((d) => ({ data: () => d })),
});
/** 送信プロンプト（第1引数）を取り出す */
const sentPrompt = () => String(mocks.gen.mock.calls[0][0]);

describe('ai/insights POST（顧客台帳の AI 分析）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 's1', uid: 'u1' });
    mocks.gen.mockReset().mockResolvedValue('{"insights":["常連が増加"],"recommendations":["誕生日連絡"]}');
    mocks.reserve.mockReset().mockResolvedValue({ ok: true, remaining: 42, total: 100, consumedMonthly: 5, consumedPurchased: 0 });
    mocks.refund.mockReset();
    mocks.ledger.mockReset();
    mocks.get.mockReset().mockResolvedValue(snap([{ name: 'あや', totalSales: 12000, rank: 'A', tags: ['太客'] }]));
  });

  it('workspaceId 欠落は 400（reserve 前短絡）', async () => {
    const res = await POST(req({ type: 'trends' }));
    expect(res.status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('クレジット不足は 429（残数と必要数を返し AI は叩かない）', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, remaining: 1, total: 100, consumedMonthly: 0, consumedPurchased: 0 });
    const res = await POST(req({ workspaceId: 'w1' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.creditsRemaining).toBe(1);
    expect(json.requiredCredits).toBe(5);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('成功: JSON を data で返し ledger に insights を記録（refund しない）', async () => {
    const res = await POST(req({ workspaceId: 'w1', type: 'trends' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ insights: ['常連が増加'], recommendations: ['誕生日連絡'] });
    expect(json.creditsRemaining).toBe(42);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'insights', 5);
    // 顧客台帳の要約が本文に載る（名前・売上）
    expect(sentPrompt()).toContain('あや');
    expect(sentPrompt()).toContain('12000');
  });

  it('type 未指定は trends プロンプト（topCustomers 形式）にフォールバック', async () => {
    await POST(req({ workspaceId: 'w1' }));
    expect(sentPrompt()).toContain('topCustomers');
  });

  it('type=relationship_risk は chatHistory の mood を集計して渡す（直近10件・接触日数つき）', async () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      sender: i % 2 === 0 ? 'customer' : 'me',
      mood: i === 10 ? 'negative' : 'positive',
      text: `m${i}`,
    }));
    // toDate() は route が呼ぶ＝route の now 捕捉より後。ちょうど 25 日前だと
    // 経過が 25 日をわずかに下回って floor が 24 になりフレークするため、1 分の余白を持たせる。
    const contactAt = new Date(Date.now() - (25 * 24 * 60 * 60 * 1000 + 60_000));
    const lastContactAt = { toDate: () => contactAt };
    mocks.get.mockResolvedValue(snap([{ name: 'みく', chatHistory: history, lastContactAt }]));

    await POST(req({ workspaceId: 'w1', type: 'relationship_risk' }));
    const body = sentPrompt();
    expect(body).toContain('coolingDown'); // relationship_risk 専用プロンプト
    // 相手発言は 6 件（偶数 index）で全て 10 件窓に収まる。うち index10 のみ negative。
    expect(body).toContain('"messageCount":6');
    expect(body).toContain('"positive":5');
    expect(body).toContain('"negative":1');
    expect(body).toContain('"lastMood":"negative"');
    expect(body).toContain('"daysSinceContact":25');
  });

  it('相手発言が無い顧客は relationship_risk の対象から除外される', async () => {
    mocks.get.mockResolvedValue(snap([
      { name: '発言なし', chatHistory: [{ sender: 'me', text: 'やっほー' }] },
      { name: 'みく', chatHistory: [{ sender: 'customer', mood: 'positive', text: 'ありがと' }] },
    ]));
    await POST(req({ workspaceId: 'w1', type: 'relationship_risk' }));
    expect(sentPrompt()).not.toContain('発言なし');
    expect(sentPrompt()).toContain('みく');
  });

  it('顧客ゼロ（empty）でも [] で分析を継続する', async () => {
    mocks.get.mockResolvedValue(snap([]));
    const res = await POST(req({ workspaceId: 'w1' }));
    expect(res.status).toBe(200);
    expect(sentPrompt()).toContain('顧客データ:\n[]');
  });

  it('Firestore 取得失敗は [] フォールバック（500 にしない）', async () => {
    mocks.get.mockRejectedValue(new Error('permission-denied'));
    const res = await POST(req({ workspaceId: 'w1' }));
    expect(res.status).toBe(200);
    expect(sentPrompt()).toContain('顧客データ:\n[]');
  });

  it('生成が throw したら refund して 500', async () => {
    mocks.gen.mockRejectedValue(new Error('upstream 503'));
    const res = await POST(req({ workspaceId: 'w1' }));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 5, expect.objectContaining({ ok: true }));
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('不正 JSON は refund して 500（ledger も記録しない）', async () => {
    mocks.gen.mockResolvedValue('分析できませんでした（JSON ではない説明文）');
    const res = await POST(req({ workspaceId: 'w1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('パースに失敗');
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  // ▼ Day95 実バグ修正の核（プロトタイプチェーン経由の索引）
  it('type がプロトタイプ由来のキー（constructor）でも trends にフォールバックする', async () => {
    await POST(req({ workspaceId: 'w1', type: 'constructor' }));
    const body = sentPrompt();
    expect(body).not.toContain('native code'); // Object 関数の文字列化が混入しない
    expect(body).toContain('topCustomers');
  });

  it('未知の type も trends にフォールバック（既存挙動）', async () => {
    await POST(req({ workspaceId: 'w1', type: 'unknown_type' }));
    expect(sentPrompt()).toContain('topCustomers');
  });

  it('mood がプロトタイプ由来のキー（constructor）でも moodCounts は 3 キーのみ', async () => {
    mocks.get.mockResolvedValue(snap([{
      name: 'みく',
      chatHistory: [
        { sender: 'customer', mood: 'constructor', text: 'a' },
        { sender: 'customer', mood: 'positive', text: 'b' },
      ],
    }]));
    await POST(req({ workspaceId: 'w1', type: 'relationship_risk' }));
    const body = sentPrompt();
    expect(body).toContain('"moodCounts":{"positive":1,"neutral":0,"negative":0}');
    expect(body).not.toContain('"constructor"');
  });

  it('【回帰・Day99】顧客のフリーテキストは maskDeep されて AI に渡る', async () => {
    // likes（likesNote）/ importantMemo / tags はユーザー自由入力で、電話・メールが普通に入る。
    // 修正前は本 route だけ maskDeep を通さず生のまま AI プロバイダへ送っていた。
    mocks.get.mockResolvedValue(snap([{
      name: 'みく',
      likesNote: '連絡先 090-1234-5678',
      importantMemo: 'mail: a@b.com',
      tags: ['080-9999-8888'],
    }]));
    await POST(req({ workspaceId: 'w1', type: 'sales' }));
    const body = sentPrompt();
    expect(body).not.toContain('090-1234-5678');
    expect(body).not.toContain('a@b.com');
    expect(body).not.toContain('080-9999-8888');
    expect(body).toContain('[電話番号非表示]');
    expect(body).toContain('[メール非表示]');
  });

});
