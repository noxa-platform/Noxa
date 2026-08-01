import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/threads（一覧 GET / 新規作成 POST）と ai/threads/[threadId]（リネーム PATCH / 削除 DELETE）
// を検証する（Day97）。AI チャットの複数会話セッションを管理する状態変更ルート群。
// 固定する挙動:
//   - workspaceId 欠落=400 / 認証失敗=401 / 越境（resolveAccessContext throw）は 401
//   - GET は自分の thread のみ（where ownerUid==uid）を updatedAt 降順で返す
//   - 個別操作の認可は doc の ownerUid 一致（他人の thread は 403・不在は PATCH 404 / DELETE は冪等 200）
//   - PATCH は title を trim して 60 字に切り詰め、updatedAt を進める
//   - **実バグ修正（Day97）**: 旧 ai_sessions からの取込条件が「threads が空」だけだったため、
//     旧 doc を rollback 用に残す方針と噛み合わず、**ユーザーが消したスレッドが次回 GET で
//     別 ID として復活**し削除が永久に確定しなかった。取込後に旧 doc へ migratedToThreadsAt を
//     立て、以後は再取込しない（旧 doc は消さずフィールド追加のみ＝rollback 可能性は維持）。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  getDb: vi.fn(),
  threadsGet: vi.fn(),
  add: vi.fn(),
  legacyGet: vi.fn(),
  legacySet: vi.fn(),
  docGet: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathAiThreads: () => 'shop_shops/w1/ai_threads',
  pathAiThread: (_ctx: unknown, id: string) => `shop_shops/w1/ai_threads/${id}`,
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { GET, POST } from '../../src/app/api/ai/threads/route';
import { PATCH, DELETE } from '../../src/app/api/ai/threads/[threadId]/route';

/** collection(...) は一覧/追加、doc(...) は legacy か個別 thread に振り分ける db モック */
function makeDb() {
  return {
    collection: () => ({
      where: () => ({ get: mocks.threadsGet }),
      add: mocks.add,
    }),
    doc: (path: string) => {
      if (path.includes('ai_sessions')) {
        return { get: mocks.legacyGet, set: mocks.legacySet };
      }
      return { get: mocks.docGet, update: mocks.update, delete: mocks.del };
    },
  };
}
const listSnap = (docs: { id: string; data: Record<string, unknown> }[]) => ({
  docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
});
const docSnap = (data: Record<string, unknown> | undefined) => ({
  exists: data !== undefined,
  data: () => data,
});
const getReq = (url: string) => ({ url: `http://localhost${url}` }) as never;
const jsonReq = (body: unknown) => ({ json: async () => body }) as never;
const params = (threadId: string) => ({ params: Promise.resolve({ threadId }) });

describe('ai/threads（AI チャットスレッドの一覧・作成）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb());
    mocks.threadsGet.mockReset().mockResolvedValue(listSnap([]));
    mocks.add.mockReset().mockResolvedValue({ id: 't-new' });
    mocks.legacyGet.mockReset().mockResolvedValue(docSnap(undefined));
    mocks.legacySet.mockReset().mockResolvedValue(undefined);
  });

  it('GET: workspaceId 欠落は 400', async () => {
    expect((await GET(getReq('/api/ai/threads'))).status).toBe(400);
    expect(mocks.threadsGet).not.toHaveBeenCalled();
  });

  it('GET: 認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await GET(getReq('/api/ai/threads?workspaceId=w1'))).status).toBe(401);
  });

  it('GET: 越境（アクセス権なし）は 401 で一覧を読まない', async () => {
    mocks.resolve.mockRejectedValue(new AuthError('この shop へのアクセス権限がありません'));
    expect((await GET(getReq('/api/ai/threads?workspaceId=other'))).status).toBe(401);
    expect(mocks.threadsGet).not.toHaveBeenCalled();
  });

  it('GET: updatedAt 降順で返し、欠損フィールドは既定値で埋める', async () => {
    mocks.threadsGet.mockResolvedValue(
      listSnap([
        { id: 'a', data: { title: '古い', createdAt: 1, updatedAt: 100, messageCount: 3 } },
        { id: 'b', data: { title: '新しい', createdAt: 2, updatedAt: 900, messageCount: 5 } },
        { id: 'c', data: {} },
      ]),
    );
    const json = await (await GET(getReq('/api/ai/threads?workspaceId=w1'))).json();
    expect(json.threads.map((t: { id: string }) => t.id)).toEqual(['b', 'a', 'c']);
    expect(json.threads[2]).toEqual({ id: 'c', title: '新しいトーク', createdAt: 0, updatedAt: 0, messageCount: 0 });
    // 一覧は既存 thread があるため legacy を読みに行かない
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('GET: 旧 ai_sessions を初回だけ「最初のトーク」として取り込み、最初のユーザー発言から題名を作る', async () => {
    mocks.legacyGet.mockResolvedValue(
      docSnap({
        updatedAt: 555,
        messages: [
          { role: 'assistant', content: 'こんにちは' },
          { role: 'user', content: '売上を分析して\nお願い' },
        ],
      }),
    );
    const json = await (await GET(getReq('/api/ai/threads?workspaceId=w1'))).json();
    const added = mocks.add.mock.calls[0][0];
    expect(added.ownerUid).toBe('u1');
    expect(added.title).toBe('売上を分析して お願い'); // 改行は空白に潰す
    expect(added.createdAt).toBe(555); // 旧 doc の updatedAt を作成日時として引き継ぐ
    expect(added.messageCount).toBe(2);
    expect(json.threads).toHaveLength(1);
    expect(json.threads[0].id).toBe('t-new');
  });

  it('GET: 30 字超の題名は … で切り詰め、ユーザー発言が無ければ既定題名', async () => {
    mocks.legacyGet.mockResolvedValue(docSnap({ messages: [{ role: 'user', content: 'あ'.repeat(40) }] }));
    await GET(getReq('/api/ai/threads?workspaceId=w1'));
    expect(mocks.add.mock.calls[0][0].title).toBe(`${'あ'.repeat(30)}…`);

    mocks.add.mockClear();
    mocks.legacyGet.mockResolvedValue(docSnap({ messages: [{ role: 'assistant', content: 'やあ' }] }));
    await GET(getReq('/api/ai/threads?workspaceId=w1'));
    expect(mocks.add.mock.calls[0][0].title).toBe('以前のチャット');
  });

  it('【Day97 修正】取込後は旧 doc に印を付け、スレッドを全部消しても復活しない', async () => {
    mocks.legacyGet.mockResolvedValue(docSnap({ messages: [{ role: 'user', content: 'やあ' }] }));
    await GET(getReq('/api/ai/threads?workspaceId=w1'));
    expect(mocks.add).toHaveBeenCalledTimes(1);
    // 取込成功後に印を付ける（旧 doc は消さずフィールド追加のみ）
    expect(mocks.legacySet).toHaveBeenCalledTimes(1);
    expect(mocks.legacySet.mock.calls[0][0]).toHaveProperty('migratedToThreadsAt');
    expect(mocks.legacySet.mock.calls[0][1]).toEqual({ merge: true });

    // 取込済みの旧 doc（印つき）で、ユーザーが thread を全削除した状態を再現
    mocks.add.mockClear();
    mocks.legacyGet.mockResolvedValue(
      docSnap({ messages: [{ role: 'user', content: 'やあ' }], migratedToThreadsAt: 1 }),
    );
    const json = await (await GET(getReq('/api/ai/threads?workspaceId=w1'))).json();
    expect(mocks.add).not.toHaveBeenCalled(); // 復活させない
    expect(json.threads).toEqual([]);
  });

  it('GET: 旧 doc が無い/空なら取込は起きない', async () => {
    const json = await (await GET(getReq('/api/ai/threads?workspaceId=w1'))).json();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.legacySet).not.toHaveBeenCalled();
    expect(json.threads).toEqual([]);

    mocks.legacyGet.mockResolvedValue(docSnap({ messages: [] }));
    await GET(getReq('/api/ai/threads?workspaceId=w1'));
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('POST: workspaceId 欠落は 400・認証失敗は 401', async () => {
    expect((await POST(jsonReq({ title: 'x' }))).status).toBe(400);
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(jsonReq({ workspaceId: 'w1' }))).status).toBe(401);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('POST: ownerUid つきで作成し、題名は空白のみ/未指定なら既定名', async () => {
    const json = await (await POST(jsonReq({ workspaceId: 'w1', title: '  売上相談  ' }))).json();
    expect(mocks.add.mock.calls[0][0]).toMatchObject({ ownerUid: 'u1', title: '売上相談', messageCount: 0, messages: [] });
    expect(json.thread.id).toBe('t-new');

    mocks.add.mockClear();
    await POST(jsonReq({ workspaceId: 'w1', title: '   ' }));
    expect(mocks.add.mock.calls[0][0].title).toBe('新しいトーク');
  });
});

describe('ai/threads/[threadId]（リネーム・削除）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb());
    mocks.docGet.mockReset().mockResolvedValue(docSnap({ ownerUid: 'u1', title: '旧題名' }));
    mocks.update.mockReset().mockResolvedValue(undefined);
    mocks.del.mockReset().mockResolvedValue(undefined);
  });

  it('PATCH: workspaceId 欠落・title 未指定/空文字は 400（doc を読まない）', async () => {
    expect((await PATCH(jsonReq({ title: 'x' }), params('t1'))).status).toBe(400);
    expect((await PATCH(jsonReq({ workspaceId: 'w1' }), params('t1'))).status).toBe(400);
    expect((await PATCH(jsonReq({ workspaceId: 'w1', title: '   ' }), params('t1'))).status).toBe(400);
    expect(mocks.docGet).not.toHaveBeenCalled();
  });

  it('PATCH: title は trim して 60 字に切り詰め、updatedAt を進める', async () => {
    const res = await PATCH(jsonReq({ workspaceId: 'w1', title: `  ${'あ'.repeat(80)}  ` }), params('t1'));
    expect(res.status).toBe(200);
    const patch = mocks.update.mock.calls[0][0];
    expect(patch.title).toBe('あ'.repeat(60));
    expect(typeof patch.updatedAt).toBe('number');
    expect((await res.json()).title).toBe('あ'.repeat(60));
  });

  it('PATCH: 他人の thread は 403・不在は 404（いずれも書き換えない）', async () => {
    mocks.docGet.mockResolvedValue(docSnap({ ownerUid: 'other' }));
    expect((await PATCH(jsonReq({ workspaceId: 'w1', title: 'x' }), params('t1'))).status).toBe(403);

    mocks.docGet.mockResolvedValue(docSnap(undefined));
    expect((await PATCH(jsonReq({ workspaceId: 'w1', title: 'x' }), params('t1'))).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('DELETE: 自分の thread は削除・他人の thread は 403（消さない）', async () => {
    expect((await DELETE(getReq('/api/ai/threads/t1?workspaceId=w1'), params('t1'))).status).toBe(200);
    expect(mocks.del).toHaveBeenCalledTimes(1);

    mocks.del.mockClear();
    mocks.docGet.mockResolvedValue(docSnap({ ownerUid: 'other' }));
    expect((await DELETE(getReq('/api/ai/threads/t1?workspaceId=w1'), params('t1'))).status).toBe(403);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('DELETE: 既に無い thread は 200（冪等）・workspaceId 欠落は 400', async () => {
    mocks.docGet.mockResolvedValue(docSnap(undefined));
    const res = await DELETE(getReq('/api/ai/threads/t1?workspaceId=w1'), params('t1'));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.del).not.toHaveBeenCalled();

    expect((await DELETE(getReq('/api/ai/threads/t1'), params('t1'))).status).toBe(400);
  });
});
