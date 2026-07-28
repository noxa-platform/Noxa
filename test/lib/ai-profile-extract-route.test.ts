import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/profile-extract の POST を画像解析モック＋クレジットモックで検証する（Day85 PM・sibling 横断）。
// 投稿画像から自分/店舗プロファイル候補を抽出。ai/parse（Day85）の画像版・同型。固定する境界:
//   - workspaceId 欠落 / images 非配列・空 = 400
//   - images 5枚以上 = 400（analyzeImages 未呼び出し）
//   - 越境（resolveAccessContext throw）= generic 500（analyzeImages 未呼び出し）
//   - 正常: 生 JSON をパースして extracted 返却＋creditsRemaining
//   - 末尾テキスト付き JSON は {…} 抽出でリカバリ、非 JSON は extracted={}
//   - 認証失敗=401
//
// 実バグは発見されず（入力検証・safe parse 健全）。本テストは executable spec（プロダクトコード不変）。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), analyze: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({ resolveAccessContext: mocks.resolve }));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ analyzeImages: mocks.analyze }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: () => {}, remaining: 7 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/profile-extract/route';

const img = { data: 'base64data', mimeType: 'image/png' };
const req = (body: unknown) => ({ json: async () => body }) as never;

describe('ai/profile-extract POST（画像→プロファイル抽出）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.analyze.mockReset().mockResolvedValue('{"stageName":"あや","gender":"female"}');
  });

  it('workspaceId 欠落は 400', async () => {
    expect((await POST(req({ images: [img] }))).status).toBe(400);
  });

  it('images 非配列/空は 400', async () => {
    expect((await POST(req({ workspaceId: 'w1', images: [] }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('images 5枚以上は 400・analyzeImages 未呼び出し', async () => {
    const res = await POST(req({ workspaceId: 'w1', images: [img, img, img, img, img] }));
    expect(res.status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req({ workspaceId: 'w1', images: [img] }))).status).toBe(401);
  });

  it('越境（resolveAccessContext throw）は generic 500・analyzeImages 未呼び出し', async () => {
    mocks.resolve.mockRejectedValue(new Error('forbidden'));
    const res = await POST(req({ workspaceId: 'other', images: [img] }));
    expect(res.status).toBe(500);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('正常: 生 JSON をパースして extracted＋creditsRemaining を返す', async () => {
    const res = await POST(req({ workspaceId: 'w1', images: [img] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      extracted: { stageName: 'あや', gender: 'female' }, creditsRemaining: 7,
    });
  });

  it('末尾テキスト付き JSON は {…} 抽出でリカバリ', async () => {
    mocks.analyze.mockResolvedValue('了解しました。\n{"storeName":"店A"}\n以上です。');
    const body = await (await POST(req({ workspaceId: 'w1', images: [img] }))).json();
    expect(body.extracted).toEqual({ storeName: '店A' });
  });

  it('非 JSON（波括弧なし）は extracted={} に安全フォールバック', async () => {
    mocks.analyze.mockResolvedValue('抽出できませんでした');
    const body = await (await POST(req({ workspaceId: 'w1', images: [img] }))).json();
    expect(body.extracted).toEqual({});
  });
});
