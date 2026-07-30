import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/message/analyze の POST を検証する（Day94）。
// スクショ画像から会話を抽出し顧客 doc の chatHistory 等に**保存する状態変更ルート**
// （FormData 入力・withReservedCredits＝canonical 引当・analyzeImages）。固定する挙動:
//   - workspaceId/customerId 欠落=400、画像0枚=400、6枚以上=400、5MB 超=400（いずれも reserve 前）
//   - 認証失敗（AuthError）=401
//   - **refund 契約（Day67）**: parse 失敗 / messages 非配列は ack せず 500 return（→refund）・update 未実行。
//     顧客 doc 不在で update が throw しても ack 前なので refund（課金残らず）。
//   - 成功: messages を mood allowlist で正規化し chatHistory に追記保存→ack。
//     - mood は positive/neutral/negative 以外を neutral に落とす
//     - chatHistory は既存＋新規を最大100件に制限（古いものから削除）
//     - customerPersonality/myMessageStyle は空でなければ追記（既存と異なる時のみ \n 連結・同一値は重複させない）
//
// 実バグは発見されず（Day89-PM 精査を再確認）。executable spec。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), analyze: vi.fn(), ack: vi.fn(), update: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomer: () => 'customers/c1',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ analyzeImages: mocks.analyze }));
vi.mock('@/lib/ai-cost', () => ({ estimateAiCost: () => 4 }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__' } }));
// ack を spy で受け、失敗時に ack されない（=refund 契約）ことを検証する。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 8 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/message/analyze/route';

// 顧客 doc を返し、update(patch) を spy で捕捉する db モック。
// updateThrows=true で不在 doc の update NOT_FOUND を模す。
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
const img = (name = 'a.png', bytes = 3) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
function makeReq(opts: { wid?: string; cid?: string; images?: File[] }) {
  const fd = new FormData();
  if (opts.wid !== undefined) fd.set('workspaceId', opts.wid);
  if (opts.cid !== undefined) fd.set('customerId', opts.cid);
  for (const f of opts.images ?? []) fd.append('images', f);
  return { formData: async () => fd } as never;
}
const base = () => ({ wid: 'w1', cid: 'c1', images: [img()] });
const okResult = '{"messages":[{"sender":"customer","text":"元気？","mood":"positive"},{"sender":"me","text":"元気だよ","mood":"neutral"}],"customerPersonality":"甘えたがり","myStyle":"絵文字多め"}';

describe('ai/message/analyze POST（スクショ→会話抽出して保存）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎', chatHistory: [] }));
    mocks.analyze.mockReset().mockResolvedValue(okResult);
    mocks.ack.mockReset();
    mocks.update.mockReset();
  });

  it('workspaceId/customerId 欠落は 400（reserve 前・analyze 未呼び出し）', async () => {
    expect((await POST(makeReq({ cid: 'c1', images: [img()] }))).status).toBe(400);
    expect((await POST(makeReq({ wid: 'w1', images: [img()] }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(makeReq(base()))).status).toBe(401);
  });

  it('画像0枚は 400 / 6枚以上は 400 / 5MB超は 400（いずれも reserve 前）', async () => {
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1' }))).status).toBe(400);
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1', images: [img(), img(), img(), img(), img(), img()] }))).status).toBe(400);
    const big = img('big.png', 5 * 1024 * 1024 + 1);
    expect((await POST(makeReq({ wid: 'w1', cid: 'c1', images: [big] }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('成功: messages を保存して messagesCount を返し ack（消費確定）', async () => {
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messagesCount).toBe(2);
    expect(json.customerPersonality).toBe('甘えたがり');
    expect(json.myStyle).toBe('絵文字多め');
    expect(json.creditsRemaining).toBe(8);
    expect(mocks.ack).toHaveBeenCalledTimes(1);
    // chatHistory に analyzedAt 付きで追記されている
    const patch = mocks.update.mock.calls[0][0];
    expect(patch.chatHistory).toHaveLength(2);
    expect(patch.chatHistory[0]).toMatchObject({ sender: 'customer', text: '元気？', mood: 'positive' });
    expect(patch.customerPersonality).toBe('甘えたがり');
    expect(patch.chatAnalyzedAt).toBe('__TS__');
  });

  it('mood は positive/neutral/negative 以外を neutral に落として保存', async () => {
    mocks.analyze.mockResolvedValue('{"messages":[{"sender":"me","text":"やあ","mood":"ハッピー"}],"customerPersonality":"","myStyle":""}');
    await POST(makeReq(base()));
    expect(mocks.update.mock.calls[0][0].chatHistory[0].mood).toBe('neutral');
  });

  it('chatHistory は既存＋新規を最大100件に制限（古いものから削除）', async () => {
    const existing = Array.from({ length: 95 }, (_, i) => ({ sender: 'me', text: `old${i}`, mood: 'neutral', analyzedAt: 'x' }));
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: existing }));
    // 新規10件
    const msgs = Array.from({ length: 10 }, (_, i) => ({ sender: 'customer', text: `new${i}`, mood: 'neutral' }));
    mocks.analyze.mockResolvedValue(JSON.stringify({ messages: msgs, customerPersonality: '', myStyle: '' }));
    await POST(makeReq(base()));
    const saved = mocks.update.mock.calls[0][0].chatHistory;
    expect(saved).toHaveLength(100);
    expect(saved[0].text).toBe('old5'); // 古い5件（old0〜old4）が削除される
    expect(saved[99].text).toBe('new9'); // 最新が末尾
  });

  it('customerPersonality は既存と異なれば \\n 追記・同一値は重複させない', async () => {
    // 既存と異なる → 追記
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], customerPersonality: '前の性格' }));
    mocks.analyze.mockResolvedValue('{"messages":[{"sender":"me","text":"a"}],"customerPersonality":"新しい性格","myStyle":""}');
    await POST(makeReq(base()));
    expect(mocks.update.mock.calls[0][0].customerPersonality).toBe('前の性格\n新しい性格');
    // 既存と同一 → 重複させない
    mocks.update.mockReset();
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], customerPersonality: '同じ性格' }));
    mocks.analyze.mockResolvedValue('{"messages":[{"sender":"me","text":"a"}],"customerPersonality":"同じ性格","myStyle":""}');
    await POST(makeReq(base()));
    expect(mocks.update.mock.calls[0][0].customerPersonality).toBe('同じ性格');
  });

  // myMessageStyle は customerPersonality と対称の別分岐（コピペドリフト検知）。
  it('myMessageStyle も既存と異なれば \\n 追記・空なら patch に載せない', async () => {
    // 既存 myMessageStyle と異なる新規 myStyle → 追記
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], myMessageStyle: '前の文体' }));
    mocks.analyze.mockResolvedValue('{"messages":[{"sender":"me","text":"a"}],"customerPersonality":"","myStyle":"新しい文体"}');
    await POST(makeReq(base()));
    expect(mocks.update.mock.calls[0][0].myMessageStyle).toBe('前の文体\n新しい文体');
    // myStyle 空 → patch に myMessageStyle を含めない（既存を上書きしない）
    mocks.update.mockReset();
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [], myMessageStyle: '既存文体' }));
    mocks.analyze.mockResolvedValue('{"messages":[{"sender":"me","text":"a"}],"customerPersonality":"","myStyle":"   "}');
    await POST(makeReq(base()));
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('myMessageStyle');
  });

  it('images に File 以外のエントリが混じっても File のみ数える（instanceof File フィルタ）', async () => {
    // FormData に文字列 'notafile' と実 File を 1 枚混ぜる → File 1枚として成功する
    const fd = new FormData();
    fd.set('workspaceId', 'w1');
    fd.set('customerId', 'c1');
    fd.append('images', 'notafile'); // 非 File → スキップ
    fd.append('images', img());
    const res = await POST({ formData: async () => fd } as never);
    expect(res.status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    // 非 File を除いた 1 枚だけが渡る
    expect(mocks.analyze.mock.calls[0][0]).toHaveLength(1);
  });

  // ▼ refund 契約（Day67）: 生成失敗は ack せず 500 return→refund・update 未実行。
  //   エラーメッセージまで固定し、専用ガードが（後段クラッシュではなく）応答していることを裏取りする。
  it('parse 失敗（非 JSON）は専用 500・ack しない・update しない（refund 契約）', async () => {
    mocks.analyze.mockResolvedValue('JSONではない説明文');
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('画像解析結果のパースに失敗しました');
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('messages 非配列は専用 500・ack しない・update しない（refund 契約）', async () => {
    mocks.analyze.mockResolvedValue('{"messages":"配列じゃない","customerPersonality":"x","myStyle":"y"}');
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(500);
    // 専用ガードの文言（後段 .map クラッシュ時の generic 文言と区別する）
    expect((await res.json()).error).toBe('会話メッセージが抽出できませんでした');
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('顧客 doc 不在（update が throw）は 500・ack しない（ack 前 throw で refund）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', chatHistory: [] }, true));
    const res = await POST(makeReq(base()));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
