import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/learn-from-text の POST を検証する（Day96）。
// LINE トーク履歴などのテキストを AI に解析させ、顧客 doc へ書き戻す**状態変更ルート**。
// **手動 reserve/refund 方式**（withReservedCredits 未使用）で、cost は文字数従量＝上限なし。
// 固定する挙動:
//   - workspaceId/customerId 欠落=400 / 本文 20 字未満=400 / 1MB 超=413（いずれも reserve 前）
//   - 認証失敗（AuthError）=401・クレジット不足=429（AI を叩かない・払い戻しもしない）
//   - 成功: 抽出値を `[AI 日付]` タグ付きで上書き、配列は mergeUnique、importantMemo は \n 追記、
//     nextAction はタグなし。ledger 記録あり・払い戻しなし
//   - 不正 JSON でも 200（抽出系の ack ポリシー。構造化分析系＝insights/seating-suggest の
//     「parse 失敗で refund」とは意図的に異なる。Day91/92/93 判定）
//   - **実バグ修正（Day96・money）**: 生成 throw 時に払い戻しが**二重に**走っていた。
//     旧実装は try 内で refund した後 `throw e` し、catch の無条件 refund でもう一度返していた
//     （refundAiCredit は非冪等な素の加算/減算）。cost は上限なしのため、確実に失敗する
//     巨大テキストを投げるだけでクレジットを増やせた。加えて catch 側は内訳を渡しておらず、
//     購入クレジットが月次枠に化ける非対称もあった。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  getDb: vi.fn(),
  gen: vi.fn(),
  reserve: vi.fn(),
  refund: vi.fn(),
  ledger: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomer: () => 'customers/c1',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 7 }));
vi.mock('@/lib/datetime', () => ({ jstCalendarDate: () => ({ date: '2026-08-02' }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__' } }));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/learn-from-text/route';

/** 顧客 doc を返し update(patch) を spy で捕捉する db モック。updateThrows で書込失敗を模す */
function makeDb(customer: Record<string, unknown> | undefined, updateThrows = false) {
  return {
    doc: () => ({
      get: async () => ({ exists: customer !== undefined, data: () => customer }),
      update: async (patch: Record<string, unknown>) => {
        if (updateThrows) throw new Error('NOT_FOUND: no document to update');
        mocks.update(patch);
      },
    }),
  };
}

const RESERVED = { ok: true, remaining: 33, total: 100, consumedMonthly: 7, consumedPurchased: 0 };
const TEXT = 'きょうはありがとう。またあそぼうね。'; // 18 文字ではなく 20 字以上（下で長さを担保）
const CONTENT = `${TEXT}またれんらくするね。`;
const req = (body: unknown) => ({ json: async () => body }) as never;
const base = (over: Record<string, unknown> = {}) => ({ workspaceId: 'w1', customerId: 'c1', content: CONTENT, ...over });
/** 実際に update された patch */
const patch = () => mocks.update.mock.calls[0][0] as Record<string, unknown>;

describe('ai/learn-from-text POST（テキスト学習→顧客カルテ書き戻し）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'personal', uid: 'u1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ likes: ['寿司'], importantMemo: '来月誕生日' }));
    mocks.gen.mockReset().mockResolvedValue(
      '{"customerPersonality":"甘えたがり","myMessageStyle":"絵文字多め","likes":["ワイン","寿司"],"importantMemo":"来週来店予定","suggestedNextAction":"誕生日メッセージを送る"}',
    );
    mocks.reserve.mockReset().mockResolvedValue(RESERVED);
    mocks.refund.mockReset();
    mocks.ledger.mockReset();
    mocks.update.mockReset();
  });

  it('workspaceId / customerId 欠落は 400（reserve 前短絡）', async () => {
    expect((await POST(req({ customerId: 'c1', content: CONTENT }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1', content: CONTENT }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('本文が非文字列・20 字未満（trim 後判定）は 400', async () => {
    expect((await POST(req(base({ content: 12345 })))).status).toBe(400);
    expect((await POST(req(base({ content: 'あ'.repeat(19) })))).status).toBe(400);
    // 前後の空白を除くと 19 字＝ちょうど下回る
    expect((await POST(req(base({ content: `   ${'あ'.repeat(19)}   ` })))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('ちょうど 20 字は通る（境界）', async () => {
    const res = await POST(req(base({ content: 'あ'.repeat(20) })));
    expect(res.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalled();
  });

  it('1MB 超は 413（バイト長判定・reserve 前）', async () => {
    // 'あ' は UTF-8 で 3 バイト → 40 万字 = 約 1.2MB（文字数では上限内でもバイト数で弾く）
    const res = await POST(req(base({ content: 'あ'.repeat(400_000) })));
    expect(res.status).toBe(413);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401（払い戻しもしない）', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(base()))).status).toBe(401);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('クレジット不足は 429（残数と必要数を返し AI を叩かない）', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, remaining: 2, total: 100, consumedMonthly: 0, consumedPurchased: 0 });
    const res = await POST(req(base()));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.creditsRemaining).toBe(2);
    expect(json.requiredCredits).toBe(7);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('成功: [AI 日付] タグ付きで書き戻し・配列は既存とマージ・ledger 記録・払い戻しなし', async () => {
    const res = await POST(req(base()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.consumedCredits).toBe(7);
    expect(json.remainingCredits).toBe(33);
    expect(json.extracted.customerPersonality).toBe('甘えたがり');

    const p = patch();
    expect(p.chatAnalyzedAt).toBe('__TS__');
    expect(p.customerPersonality).toBe('[AI 2026-08-02] 甘えたがり');
    expect(p.myMessageStyle).toBe('[AI 2026-08-02] 絵文字多め');
    // mergeUnique: 既存 ['寿司'] + 抽出 ['ワイン','寿司'] → 重複しない
    expect(p.likes).toEqual(['寿司', 'ワイン']);
    // importantMemo は既存を残して \n 追記（上書きしない）
    expect(p.importantMemo).toBe('来月誕生日\n[AI 2026-08-02] 来週来店予定');
    // nextAction はタグを付けない
    expect(p.nextAction).toBe('誕生日メッセージを送る');

    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'learn-from-text', 7);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('抽出が空のフィールドは patch に載せない（既存値を消さない）', async () => {
    mocks.gen.mockResolvedValue('{"customerPersonality":null,"likes":[],"importantMemo":"  "}');
    expect((await POST(req(base()))).status).toBe(200);
    expect(Object.keys(patch())).toEqual(['chatAnalyzedAt']);
  });

  it('300 字を超える抽出値は … で切り詰める', async () => {
    mocks.gen.mockResolvedValue(JSON.stringify({ customerPersonality: 'あ'.repeat(400) }));
    await POST(req(base()));
    expect(patch().customerPersonality).toBe(`[AI 2026-08-02] ${'あ'.repeat(300)}…`);
  });

  it('コードフェンス混じりでも {…} を抽出して書き戻す', async () => {
    mocks.gen.mockResolvedValue('```json\n{"customerPersonality":"素直"}\n```');
    expect((await POST(req(base()))).status).toBe(200);
    expect(patch().customerPersonality).toBe('[AI 2026-08-02] 素直');
  });

  it('不正 JSON でも 200（全空で書き戻し・払い戻さない＝抽出系の ack ポリシー）', async () => {
    mocks.gen.mockResolvedValue('解析できませんでした');
    const res = await POST(req(base()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extracted.customerPersonality).toBeNull();
    expect(json.extracted.likes).toEqual([]);
    expect(Object.keys(patch())).toEqual(['chatAnalyzedAt']);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('【Day96 修正】生成 throw は 500 で払い戻しは "ちょうど 1 回"（旧実装は二重返金）', async () => {
    mocks.gen.mockRejectedValue(new Error('provider timeout'));
    const res = await POST(req(base()));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 7, RESERVED);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('顧客 doc 不在は 404・払い戻しは 1 回（内訳つき）', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined));
    const res = await POST(req(base()));
    expect(res.status).toBe(404);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 7, RESERVED);
  });

  it('【Day96 修正】書込失敗は 500・保険の払い戻しも予約と同じ内訳で返す', async () => {
    mocks.getDb.mockReturnValue(makeDb({}, true));
    const res = await POST(req(base()));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    // 内訳なし refund だと購入クレジットが月次枠に化けるため、reserved をそのまま渡す
    expect(mocks.refund).toHaveBeenCalledWith('u1', 7, RESERVED);
  });
});
