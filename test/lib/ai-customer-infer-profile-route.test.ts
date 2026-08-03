import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/customer-infer-profile の POST を Admin SDK モック＋LLM モックで検証する（Day86）。
// 顧客1件の過去ログ＋既存プロフィールを AI に渡し、AI 学習フィールド候補を推定して返す
// （既存値は上書きせず候補提示）。money＋テナント＋LLM トラスト境界。固定する挙動:
//   - workspaceId / customerId 欠落 = 400
//   - 越境（resolveAccessContext throw）= generic 500（LLM 未呼び出し）
//   - 顧客不在 = 404、接触ログ 0 件 = 400（いずれも LLM 未呼び出し）
//   - 正常: LLM 生 JSON をパースして inferred＋basedOnLogs（ログ件数）＋creditsRemaining
//   - 非 JSON 応答は { summary: raw, confidence: 'low' } にフォールバック
//   - 認証失敗 = 401
//
// 実バグは発見されず（Day63 の pathCustomer(ctx) 移行で IDOR 無し・resolveAccessContext で
// テナント境界・ack 後消費/失敗 refund）。朝の §0.1 で未使用 import verifyWorkspaceAccess を
// 除去済み（Day63 移行の残骸・挙動不変）。本テストは executable spec。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), gen: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathCustomer: () => 'customers/c1',
  pathCustomerLogs: () => 'customers/c1/logs',
}));
vi.mock('../../src/app/api/ai/ai-provider', () => ({ generateText: mocks.gen }));
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: () => {}, remaining: 9 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/customer-infer-profile/route';

// customer=undefined で不在、logs 配列でログ群を表現するフェイク Firestore。
function makeDb(customer: Record<string, unknown> | undefined, logs: Record<string, unknown>[] = []) {
  return {
    doc: () => ({ get: async () => ({ exists: customer !== undefined, data: () => customer }) }),
    collection: () => ({
      orderBy: () => ({
        limit: () => ({ get: async () => ({ docs: logs.map((l) => ({ data: () => l })) }) }),
      }),
    }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = { workspaceId: 'w1', customerId: 'c1' };

describe('ai/customer-infer-profile POST（顧客プロフィール推定）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎' }, [{ type: '来店', memo: 'a' }, { type: '同伴', memo: 'b' }]));
    mocks.gen.mockReset().mockResolvedValue('{"mbti":"INTJ","confidence":"medium"}');
  });

  it('workspaceId 欠落は 400', async () => {
    expect((await POST(req({ customerId: 'c1' }))).status).toBe(400);
  });

  it('customerId 欠落は 400', async () => {
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(req(okBody))).status).toBe(401);
  });

  it('越境（resolveAccessContext throw）は generic 500・LLM 未呼び出し', async () => {
    mocks.resolve.mockRejectedValue(new Error('forbidden'));
    const res = await POST(req({ workspaceId: 'other', customerId: 'c1' }));
    expect(res.status).toBe(500);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('顧客不在は 404・LLM 未呼び出し', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined, []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(404);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('接触ログ 0 件は 400・LLM 未呼び出し', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎' }, []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
  });

  it('正常: LLM 生 JSON をパースし inferred＋basedOnLogs＋creditsRemaining を返す', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      inferred: { mbti: 'INTJ', confidence: 'medium' },
      basedOnLogs: 2,
      creditsRemaining: 9,
    });
  });

  it('非 JSON 応答は { summary: raw, confidence: low } にフォールバック', async () => {
    mocks.gen.mockResolvedValue('推定不能なテキスト');
    const body = await (await POST(req(okBody))).json();
    expect(body.inferred).toEqual({ summary: '推定不能なテキスト', confidence: 'low' });
    expect(body.basedOnLogs).toBe(2);
  });

  it('【回帰・Day99】既存プロフィールとログ memo のフリーテキストはマスクされて AI に渡る', async () => {
    mocks.getDb.mockReturnValue(makeDb(
      { name: '太郎', likesNote: 'TEL 090-1234-5678', ngNote: 'a@b.com' },
      [{ type: 'visit', memo: '連絡先 080-9999-8888' }, { type: 'call' }],
    ));
    await POST(req(okBody));
    const sent = String(mocks.gen.mock.calls[0][0]);
    expect(sent).not.toContain('090-1234-5678');
    expect(sent).not.toContain('a@b.com');
    expect(sent).not.toContain('080-9999-8888');
    expect(sent).toContain('[電話番号非表示]');
    expect(sent).toContain('[メール非表示]');
  });

});
