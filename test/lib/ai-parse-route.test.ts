import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/parse の POST を Admin SDK モック＋LLM モックで検証する（Day85）。
// 自然言語クイック入力のクラウド解析（オンデバイス Foundation Models のフォールバック）。
// LLM トラスト境界として固定する挙動:
//   - 入力検証: workspaceId 必須(400) / text 必須・空白のみ拒否(400) / 16KB 超(413)
//   - 認証失敗=401、テナント解決失敗（越境）は generic 500
//   - LLM 出力の防御的正規化（信頼できない生JSON→型保証された result）:
//       * コードフェンス除去してパース、非JSON は全 unknown フォールバック
//       * kind は許可3値以外 'unknown'、amount/groupCount は数値化+trunc、bool は ===true のみ
//
// クレジット引当（withReservedCredits）は Day67 で spec 済みのためモックで通し、
// 本テストは未カバーの「入力検証＋出力正規化」に集中する（プロダクトコード不変）。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), gen: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({
  generateText: mocks.gen,
}));
// クレジット確保はコールバックをそのまま実行して素通し（remaining は固定 42）。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: () => {}, remaining: 42 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/parse/route';

const req = (body: unknown) => ({ json: async () => body }) as never;
const badJsonReq = () => ({ json: async () => { throw new Error('bad'); } }) as never;

describe('ai/parse POST（NL クイック入力の解析・LLM トラスト境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({});
    mocks.gen.mockReset();
  });

  // ── 入力検証 ───────────────────────────────
  it('workspaceId 欠落は 400', async () => {
    const res = await POST(req({ text: 'あ' }));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('不正 JSON ボディは {} 扱いで workspaceId 欠落の 400', async () => {
    expect((await POST(badJsonReq())).status).toBe(400);
  });

  it('text 欠落は 400', async () => {
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
  });

  it('text 空白のみは 400（trim 後 0 文字）', async () => {
    expect((await POST(req({ workspaceId: 'w1', text: '　  \n' }))).status).toBe(400);
  });

  it('本文 16KB 超は 413', async () => {
    const big = 'あ'.repeat(6000); // 'あ'=3byte → 18000byte > 16384
    const res = await POST(req({ workspaceId: 'w1', text: big }));
    expect(res.status).toBe(413);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  // ── 認可・認証 ─────────────────────────────
  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req({ workspaceId: 'w1', text: 'あ' }))).status).toBe(401);
  });

  it('テナント解決失敗（越境拒否）は generic 500・LLM 未呼び出し', async () => {
    mocks.resolve.mockRejectedValue(new Error('forbidden'));
    const res = await POST(req({ workspaceId: 'other', text: 'あ' }));
    expect(res.status).toBe(500);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  // ── LLM 出力の防御的正規化 ─────────────────
  it('正常: 有効 JSON を正規化し creditsRemaining を返す', async () => {
    mocks.gen.mockResolvedValue(JSON.stringify({
      kind: 'visitLog', customerName: 'A', amount: 30000, groupCount: 2,
      withDouhan: true, withAfter: false, whenText: '明日19時', place: '店', memo: 'x',
    }));
    const res = await POST(req({ workspaceId: 'w1', text: 'Aさん来店3万' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: 'visitLog', customerName: 'A', amount: 30000, groupCount: 2,
      withDouhan: true, withAfter: false, whenText: '明日19時', place: '店', memo: 'x',
      creditsRemaining: 42,
    });
  });

  it('コードフェンス付き JSON は除去してパースする', async () => {
    mocks.gen.mockResolvedValue('```json\n{"kind":"reminder","whenText":"明日"}\n```');
    const body = await (await POST(req({ workspaceId: 'w1', text: '明日約束' }))).json();
    expect(body.kind).toBe('reminder');
    expect(body.whenText).toBe('明日');
  });

  it('非 JSON 応答は全 unknown フォールバック', async () => {
    mocks.gen.mockResolvedValue('解析できませんでした（説明文）');
    const body = await (await POST(req({ workspaceId: 'w1', text: '???' }))).json();
    expect(body).toEqual({
      kind: 'unknown', customerName: '', amount: 0, groupCount: 0,
      withDouhan: false, withAfter: false, whenText: '', place: '', memo: '',
      creditsRemaining: 42,
    });
  });

  it('kind が許可3値以外は unknown に丸める', async () => {
    mocks.gen.mockResolvedValue(JSON.stringify({ kind: 'evilInjection' }));
    const body = await (await POST(req({ workspaceId: 'w1', text: 'x' }))).json();
    expect(body.kind).toBe('unknown');
  });

  it('amount/groupCount は数値化+trunc、bool は ===true のみ、非文字列は空文字', async () => {
    mocks.gen.mockResolvedValue(JSON.stringify({
      kind: 'standaloneSale',
      amount: '30000',        // 文字列 → 30000
      groupCount: 2.9,        // 小数 → trunc 2
      withDouhan: 'true',     // 文字列 'true' は false（===true でない）
      withAfter: 1,           // 数値 1 も false
      customerName: 42,       // 非文字列 → ''
      whenText: null,         // null → ''
    }));
    const body = await (await POST(req({ workspaceId: 'w1', text: 'フリー3万' }))).json();
    expect(body).toMatchObject({
      kind: 'standaloneSale', amount: 30000, groupCount: 2,
      withDouhan: false, withAfter: false, customerName: '', whenText: '',
    });
  });

  it('amount が数値化不能なら 0', async () => {
    mocks.gen.mockResolvedValue(JSON.stringify({ kind: 'visitLog', amount: 'たくさん' }));
    const body = await (await POST(req({ workspaceId: 'w1', text: 'x' }))).json();
    expect(body.amount).toBe(0);
  });
});
