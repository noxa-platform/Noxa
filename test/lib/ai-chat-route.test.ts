import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/chat（652行・AI チャット本体）を検証する（Day98）。
// reserve/refund・顧客コンテキスト合成・画像経路・SSE ストリーム経路・スレッド永続化の合流点で、
// これまでゼロカバレッジだった。固定する挙動:
//   - 認証失敗=401 / workspaceId・message 欠落=400 / threadId 欠落=400（旧クライアント救済は廃止済み）
//   - クレジット不足=429（残高と必要数を返す）／モデル呼出前の失敗は必ず refund
//   - **実バグ修正1（PII）**: 顧客 50 人超のワークスペースだけ「全顧客サマリー」が maskDeep を
//     通らず、tags に書かれた電話番号/メールが生のまま AI へ送られていた（Day12 ガードの穴）。
//   - **実バグ修正2（PII）**: 「顧客なし日売」の memo/place も同じプロンプトに載るのに素通しだった。
//   - **実バグ修正3（500）**: 画像経路の `formData.getAll('images')` を無条件に File[] とみなしており、
//     File 以外（文字列など）が混じると `.arrayBuffer` で 500。sibling の message/analyze には
//     あるガードがここだけ欠けていた。
//   - 生成失敗時は refund＋SSE の error イベント、成功時のみ台帳 logAiLedger を計上
//   - スレッド永続化は ownerUid 一致が条件・直近 100 件へトリム・既定題名は初回発言で命名

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  customersGet: vi.fn(),
  standaloneGet: vi.fn(),
  threadGet: vi.fn(),
  threadUpdate: vi.fn(),
  reserve: vi.fn(),
  refund: vi.fn(),
  ledger: vi.fn(),
  chatStream: vi.fn(),
  analyzeImages: vi.fn(),
  openRouterStream: vi.fn(),
  workspaceCtx: vi.fn(),
  getUser: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
  getAdminAuth: () => ({ getUser: mocks.getUser }),
  getAdminDb: () => ({
    collection: (path: string) =>
      path.includes('customers')
        ? { get: mocks.customersGet }
        : { where: () => ({ orderBy: () => ({ limit: () => ({ get: mocks.standaloneGet }) }) }) },
    doc: () => ({ get: mocks.threadGet, update: mocks.threadUpdate }),
  }),
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomers: () => 'shop_shops/w1/customers',
  pathStandaloneSales: () => 'personal_sales/u1/standalone',
  pathAiThread: (_ctx: unknown, id: string) => `shop_shops/w1/ai_threads/${id}`,
}));
vi.mock('../../src/app/api/lib/credits', () => ({
  reserveAiCredit: mocks.reserve,
  refundAiCredit: mocks.refund,
  logAiLedger: mocks.ledger,
}));
// ⚠️ **resolveChatModel は本物を使う**（部分モック）。ここをモックにすると
// 「実際に呼ぶモデルを決める」唯一の場所がテストから消え、SSE meta のモデル名が
// 実態とズレていた P153 ③ の再発を検知できない。
vi.mock('../../src/app/api/ai/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/api/ai/ai-provider')>()),
  generateChatStream: mocks.chatStream,
  analyzeImages: mocks.analyzeImages,
}));
vi.mock('../../src/app/api/ai/openrouter', () => ({
  generateOpenRouterStream: mocks.openRouterStream,
  generateOpenRouterText: vi.fn(),
}));
vi.mock('@/lib/ai-knowledge/prompt-helpers', () => ({
  resolveWorkspaceContext: mocks.workspaceCtx,
  composePlaybookAndSelf: () => ({ combined: '(playbook)' }),
}));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/chat/route';

/** JSON（テキストのみ）リクエスト */
const jsonReq = (body: unknown) =>
  ({ headers: { get: () => 'application/json' }, json: async () => body }) as never;
/** multipart（画像付き）リクエスト */
const formReq = (fd: FormData) =>
  ({ headers: { get: () => 'multipart/form-data' }, formData: async () => fd }) as never;

const customerSnap = (docs: Record<string, unknown>[]) => ({
  empty: docs.length === 0,
  docs: docs.map((d) => ({ data: () => d })),
});
const threadSnap = (data: Record<string, unknown> | undefined) => ({
  exists: data !== undefined,
  data: () => data,
});

/** SSE 本文を最後まで読み切る */
async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}
/** SSE から meta イベントの JSON を取り出す */
function metaOf(sse: string): Record<string, unknown> {
  const line = sse.split('\n').find((l) => l.startsWith('data: ') && l.includes('"type":"meta"'));
  return JSON.parse(line!.slice('data: '.length));
}
/** 直近の generateChatStream 呼び出しに渡されたユーザープロンプト */
const lastPrompt = () => mocks.chatStream.mock.calls.at(-1)![0] as string;

const okBody = { workspaceId: 'w1', threadId: 't1', message: 'ゆかさん最近どう？' };

describe('ai/chat（AI チャット本体）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1' });
    mocks.customersGet.mockReset().mockResolvedValue(customerSnap([]));
    mocks.standaloneGet.mockReset().mockResolvedValue({ empty: true, docs: [] });
    mocks.threadGet.mockReset().mockResolvedValue(threadSnap({ ownerUid: 'u1', messages: [], title: '新しいトーク' }));
    mocks.threadUpdate.mockReset().mockResolvedValue(undefined);
    mocks.reserve.mockReset().mockResolvedValue({ ok: true, remaining: 99 });
    mocks.refund.mockReset().mockResolvedValue(undefined);
    mocks.ledger.mockReset().mockResolvedValue(undefined);
    mocks.workspaceCtx.mockReset().mockResolvedValue({ storeType: 'cabakura', selfData: {}, storeProfile: {} });
    mocks.chatStream.mockReset().mockImplementation(async (_p: string, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('{"reply":"了解です"}');
    });
    mocks.analyzeImages.mockReset().mockResolvedValue('{"reply":"画像みました"}');
    mocks.openRouterStream.mockReset().mockResolvedValue('{"reply":"or"}');
    mocks.getUser.mockReset().mockResolvedValue({ email: 'user@example.com' });
    mocks.isAdmin.mockReset().mockReturnValue(false);
    // 本番は必ず設定されている前提（未設定は「運営の設定漏れ」で、下に専用テストを置く）
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:test/fast';
    process.env.AI_PRIMARY_MODEL_THINK = 'openrouter:test/think';
    delete process.env.AI_PRIMARY_MODEL_LITE;
  });

  // --- 入力検証・認可 ---

  it('認証失敗は 401（クレジットを予約しない）', async () => {
    mocks.verify.mockRejectedValue(new AuthError('no auth'));
    const res = await POST(jsonReq(okBody));
    expect(res.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('workspaceId / message 欠落は 400', async () => {
    expect((await POST(jsonReq({ threadId: 't1', message: 'あ' }))).status).toBe(400);
    expect((await POST(jsonReq({ workspaceId: 'w1', threadId: 't1' }))).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('threadId 欠落は 400（旧 ai_sessions フォールバックは廃止済み）', async () => {
    const res = await POST(jsonReq({ workspaceId: 'w1', message: 'あ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'threadId は必須です' });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  // --- クレジット（reserve / refund / 台帳）---

  it('クレジット不足は 429 で残高と必要数を返す（生成しない）', async () => {
    mocks.reserve.mockResolvedValue({ ok: false, remaining: 2 });
    const res = await POST(jsonReq(okBody));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ creditsRemaining: 2, requiredCredits: 1 });
    expect(mocks.chatStream).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('think モードは fast の 3 倍で予約する', async () => {
    await readSse((await POST(jsonReq({ ...okBody, modelMode: 'think' }))) as Response);
    expect(mocks.reserve).toHaveBeenCalledWith('u1', 3);
  });

  it('モデル呼出前（コンテキスト取得）の失敗は refund してから 500', async () => {
    mocks.workspaceCtx.mockRejectedValue(new Error('firestore down'));
    const res = await POST(jsonReq(okBody));
    expect(res.status).toBe(500);
    expect(mocks.refund).toHaveBeenCalledWith('u1', 1, { ok: true, remaining: 99 });
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('生成失敗は refund して SSE の error イベントを返す（台帳に計上しない）', async () => {
    mocks.chatStream.mockRejectedValue(new Error('gemini 503'));
    const sse = await readSse((await POST(jsonReq(okBody))) as Response);
    expect(sse).toContain('"type":"error"');
    expect(mocks.refund).toHaveBeenCalledWith('u1', 1, { ok: true, remaining: 99 });
    expect(mocks.ledger).not.toHaveBeenCalled();
  });

  it('成功時のみ台帳へ計上し、meta に残高を返す', async () => {
    const meta = metaOf(await readSse((await POST(jsonReq(okBody))) as Response));
    expect(meta).toMatchObject({ reply: '了解です', creditsRemaining: 99, modelMode: 'fast' });
    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'chat', 1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  // --- PII マスク（Day12 ガード）---

  it('顧客 50 人以下：詳細のフリーテキストがマスクされる', async () => {
    mocks.customersGet.mockResolvedValue(
      customerSnap([{ name: 'ゆか', memo: '', likesNote: '連絡先 090-1234-5678' }]),
    );
    await readSse((await POST(jsonReq(okBody))) as Response);
    expect(lastPrompt()).toContain('[電話番号非表示]');
    expect(lastPrompt()).not.toContain('090-1234-5678');
  });

  it('【回帰】顧客 50 人超でも全顧客サマリーの tags がマスクされる', async () => {
    // 51 人 = サマリー経路。言及されない顧客の tags は UI 自由入力のフリーテキスト。
    const docs = Array.from({ length: 51 }, (_, i) => ({ name: `客${i}`, tags: [] as string[] }));
    docs[0] = { name: '客0', tags: ['090-1234-5678', 'a@b.com'] };
    mocks.customersGet.mockResolvedValue(customerSnap(docs));
    await readSse((await POST(jsonReq({ ...okBody, message: 'この客どう？' }))) as Response);
    expect(lastPrompt()).toContain('全顧客サマリー');
    expect(lastPrompt()).not.toContain('090-1234-5678');
    expect(lastPrompt()).not.toContain('a@b.com');
    expect(lastPrompt()).toContain('[電話番号非表示]');
    expect(lastPrompt()).toContain('[メール非表示]');
  });

  it('【回帰】顧客なし日売の memo もマスクされる', async () => {
    mocks.standaloneGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({
            datetime: { toDate: () => new Date('2026-08-01T12:00:00Z') },
            salesAmount: 30000,
            memo: '常連 090-9876-5432',
            place: null,
          }),
        },
      ],
    });
    await readSse((await POST(jsonReq(okBody))) as Response);
    expect(lastPrompt()).toContain('顧客なし日売');
    expect(lastPrompt()).not.toContain('090-9876-5432');
    expect(lastPrompt()).toContain('[電話番号非表示]');
  });

  it('顧客ゼロでも生成は進む（「顧客はいません」を明示）', async () => {
    await readSse((await POST(jsonReq(okBody))) as Response);
    expect(lastPrompt()).toContain('現在登録されている顧客はいません。');
  });

  // --- 画像経路 ---

  it('【回帰】images に File 以外が混じっても 500 にならず、File だけを解析する', async () => {
    const fd = new FormData();
    fd.set('workspaceId', 'w1');
    fd.set('threadId', 't1');
    fd.set('message', 'これ見て');
    fd.append('images', 'not-a-file'); // 旧実装はここで .arrayBuffer が無く 500
    fd.append('images', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    const res = (await POST(formReq(fd))) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reply: '画像みました' });
    expect(mocks.analyzeImages.mock.calls[0][0]).toHaveLength(1);
    // 画像 1 枚 = base 1 + 2cr
    expect(mocks.reserve).toHaveBeenCalledWith('u1', 3);
    expect(mocks.ledger).toHaveBeenCalledWith('u1', 'chat', 3);
  });

  it('5MB 超の画像はスキップし、コストにも数えない', async () => {
    const fd = new FormData();
    fd.set('workspaceId', 'w1');
    fd.set('threadId', 't1');
    fd.set('message', 'これ見て');
    fd.append('images', new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' }));
    const res = (await POST(formReq(fd))) as Response;
    expect(res.status).toBe(200);
    // 画像 0 枚扱い＝テキスト経路（SSE）に落ちる
    expect(mocks.reserve).toHaveBeenCalledWith('u1', 1);
    expect(mocks.analyzeImages).not.toHaveBeenCalled();
    await readSse(res);
  });

  // --- 応答パース ---

  it('途中で切れた JSON でも reply を救出する', async () => {
    mocks.chatStream.mockImplementation(async (_p: string, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('{"reply":"途中まで書いたと');
    });
    const meta = metaOf(await readSse((await POST(jsonReq(okBody))) as Response));
    expect(meta.reply).toBe('途中まで書いたと');
  });

  it('actions は配列かつ非空のときだけ返す', async () => {
    mocks.chatStream.mockImplementation(async (_p: string, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('{"reply":"記録します","actions":[{"type":"add_log"}]}');
    });
    const meta = metaOf(await readSse((await POST(jsonReq(okBody))) as Response));
    expect(meta.actions).toEqual([{ type: 'add_log' }]);
  });

  // --- スレッド永続化 ---

  it('初回発言でスレッド題名を 30 字に切り詰めて命名し、messages を追記する', async () => {
    const long = 'あ'.repeat(40);
    await readSse((await POST(jsonReq({ ...okBody, message: long }))) as Response);
    const patch = mocks.threadUpdate.mock.calls[0][0];
    expect(patch.title).toBe('あ'.repeat(30) + '…');
    expect(patch.messages).toHaveLength(2);
    expect(patch.messageCount).toBe(2);
  });

  it('既存メッセージがあるスレッドは改名しない・直近 100 件へトリムする', async () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `m${i}`, ts: i }));
    mocks.threadGet.mockResolvedValue(threadSnap({ ownerUid: 'u1', messages: existing, title: '新しいトーク' }));
    await readSse((await POST(jsonReq(okBody))) as Response);
    const patch = mocks.threadUpdate.mock.calls[0][0];
    expect(patch.title).toBeUndefined();
    expect(patch.messages).toHaveLength(100);
    expect(patch.messages[0].content).toBe('m2'); // 古い 2 件が押し出される
  });

  it('他人のスレッドには書き込まない（応答自体は返す）', async () => {
    mocks.threadGet.mockResolvedValue(threadSnap({ ownerUid: 'other', messages: [] }));
    const meta = metaOf(await readSse((await POST(jsonReq(okBody))) as Response));
    expect(meta.reply).toBe('了解です');
    expect(mocks.threadUpdate).not.toHaveBeenCalled();
  });

  // --- モデル override（運営者限定）---

  /** 直近の generateChatStream に渡されたモデル ID */
  const lastModel = () => (mocks.chatStream.mock.calls.at(-1)![1] as { model?: string }).model;

  it('一般ユーザーが送った overrideModel は無視され、env の既定モデルで呼ばれる', async () => {
    await readSse((await POST(jsonReq({ ...okBody, overrideModel: 'openrouter:evil/model' }))) as Response);
    expect(lastModel()).toBe('test/fast');
  });

  it('admin の overrideModel は実際に呼ぶモデルになる', async () => {
    mocks.isAdmin.mockReturnValue(true);
    await readSse((await POST(jsonReq({ ...okBody, overrideModel: 'openrouter:anthropic/claude' }))) as Response);
    expect(lastModel()).toBe('anthropic/claude');
  });

  it('env の既定 override は一般ユーザーにも適用される', async () => {
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:google/gemini';
    await readSse((await POST(jsonReq(okBody))) as Response);
    expect(lastModel()).toBe('google/gemini');
  });

  it('think モードは THINK 側の env モデルで呼ばれる', async () => {
    await readSse((await POST(jsonReq({ ...okBody, modelMode: 'think' }))) as Response);
    expect(lastModel()).toBe('test/think');
  });

  // --- P153: 経路の一本化と実モデル名の申告 ---

  it('SSE meta の model は**実際に呼んだモデル**（固定の gemini 名を返さない）', async () => {
    const meta = metaOf(await readSse((await POST(jsonReq(okBody))) as Response));
    expect(meta.model).toBe('test/fast');
    expect(meta.model).not.toBe('gemini-2.5-flash');
  });

  it('画像経路にも override が効く（従来ここだけ env 固定だった）', async () => {
    mocks.isAdmin.mockReturnValue(true);
    const fd = new FormData();
    fd.set('workspaceId', 'w1');
    fd.set('threadId', 't1');
    fd.set('message', 'これ見て');
    fd.set('overrideModel', 'openrouter:anthropic/claude');
    fd.set('images', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }));
    const res = (await POST(formReq(fd))) as Response;
    const body = await res.json();
    expect((mocks.analyzeImages.mock.calls[0][2] as { model?: string }).model).toBe('anthropic/claude');
    expect(body.model).toBe('anthropic/claude');
  });

  it('モデル未設定は 500 で、**クレジットを予約しない**', async () => {
    delete process.env.AI_PRIMARY_MODEL_FAST;
    const res = (await POST(jsonReq(okBody))) as Response;
    expect(res.status).toBe(500);
    // 従来は予約 → ストリーム内で throw → 返金、という往復が発生していた
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
