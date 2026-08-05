import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/chat/history の GET / DELETE を検証する（Day101・ゼロカバレッジ解消）。
// AI チャットのスレッド単位の履歴取得とクリア。固定する挙動:
//   - workspaceId / threadId のどちらが欠けても 400（片方だけのメッセージ違いも固定）
//   - 認証失敗（AuthError）=401
//   - **所有者チェック**: ownerUid !== 呼び出し uid なら 403（同一 WS の他メンバーでも読めない/消せない）
//   - スレッド doc 不在: GET は messages:[] / DELETE は ok:true（どちらも 404 にしない＝冪等）
//   - DELETE は messages を空・messageCount を 0 にするが **doc 自体は消さない**
//     （タイトルやスレッド一覧は残す。ai/threads DELETE との役割分担）
//   - 保存先は pathAiThread（personal / shop で分岐する context helper）で解決する
//     ＝ ai/chat の書込先と一致させる契約

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  getDb: vi.fn(),
  update: vi.fn(),
  path: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathAiThread: (ctx: unknown, threadId: string) => {
    mocks.path(ctx, threadId);
    return `shop_shops/w1/ai_threads/${threadId}`;
  },
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { GET, DELETE } from '../../src/app/api/ai/chat/history/route';

/** スレッド doc を返し、update(patch) を spy で捕捉する db モック（undefined で不在） */
function makeDb(thread: Record<string, unknown> | undefined) {
  return {
    doc: () => ({
      get: async () => ({ exists: thread !== undefined, data: () => thread }),
      update: async (patch: Record<string, unknown>) => { mocks.update(patch); },
    }),
  };
}
const makeReq = (qs: string) => ({ url: `https://noxa.test/api/ai/chat/history${qs}` }) as never;
const ok = '?workspaceId=w1&threadId=t1';

describe('ai/chat/history（AI チャット履歴の取得とクリア）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({
      ownerUid: 'u1',
      messages: [{ role: 'user', content: 'やあ' }],
      updatedAt: 1234,
      title: '売上の相談',
    }));
    mocks.update.mockReset();
    mocks.path.mockReset();
  });

  it('GET: workspaceId / threadId の欠落はそれぞれ 400', async () => {
    const noWs = await GET(makeReq('?threadId=t1'));
    expect(noWs.status).toBe(400);
    expect((await noWs.json()).error).toContain('workspaceId');

    const noThread = await GET(makeReq('?workspaceId=w1'));
    expect(noThread.status).toBe(400);
    expect((await noThread.json()).error).toContain('threadId');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('GET: 認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await GET(makeReq(ok))).status).toBe(401);
  });

  it('GET: 自分のスレッドは messages / updatedAt / title を返す', async () => {
    const res = await GET(makeReq(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [{ role: 'user', content: 'やあ' }],
      updatedAt: 1234,
      title: '売上の相談',
    });
    // 保存先は context helper 経由（ai/chat の書込先と一致させる契約）
    expect(mocks.path).toHaveBeenCalledWith({ kind: 'shop', workspaceId: 'w1' }, 't1');
  });

  it('GET: 他人のスレッド（ownerUid 不一致）は 403', async () => {
    mocks.getDb.mockReturnValue(makeDb({ ownerUid: 'u2', messages: [{ role: 'user', content: '秘密' }] }));
    const res = await GET(makeReq(ok));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('秘密');
  });

  it('GET: スレッド doc 不在は 404 にせず空配列', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined));
    const res = await GET(makeReq(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
  });

  it('GET: messages 未設定の doc でも空配列で返す（undefined を漏らさない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ ownerUid: 'u1' }));
    expect(await (await GET(makeReq(ok))).json()).toEqual({ messages: [], updatedAt: null, title: null });
  });

  it('DELETE: workspaceId / threadId の欠落はそれぞれ 400', async () => {
    expect((await DELETE(makeReq('?threadId=t1'))).status).toBe(400);
    expect((await DELETE(makeReq('?workspaceId=w1'))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('DELETE: 認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await DELETE(makeReq(ok))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('DELETE: messages を空・messageCount を 0 にするが doc は消さない', async () => {
    const res = await DELETE(makeReq(ok));
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const patch = mocks.update.mock.calls[0][0];
    expect(patch.messages).toEqual([]);
    expect(patch.messageCount).toBe(0);
    expect(typeof patch.updatedAt).toBe('number');
    // title 等は残す（スレッド一覧から消えない）
    expect(patch).not.toHaveProperty('title');
  });

  it('DELETE: 他人のスレッドは 403 で更新しない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ ownerUid: 'u2', messages: [{ role: 'user', content: 'x' }] }));
    expect((await DELETE(makeReq(ok))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('DELETE: スレッド doc 不在は ok:true（冪等・更新しない）', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined));
    const res = await DELETE(makeReq(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('越境（resolveAccessContext の AuthError）は GET / DELETE ともに 401', async () => {
    mocks.resolve.mockRejectedValue(new AuthError('権限がありません'));
    expect((await GET(makeReq(ok))).status).toBe(401);
    expect((await DELETE(makeReq(ok))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
