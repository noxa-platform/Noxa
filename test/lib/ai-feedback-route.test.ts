import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stripComments } from '../helpers/strip-comments';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// ai/feedback の POST を検証する（Day101・ゼロカバレッジ解消）。
// AI 生成物への 👍/👎 を①ワークスペース内へ記録し、②opt-in 時は**ワークスペース横断**の
// `ai_knowledge/*` へ匿名化して寄与する2段構えのルート。固定する挙動:
//   - 入力検証: workspaceId / source / rating(number) 欠落=400、本文 1MB 超=413（保存前）
//   - 認証失敗（AuthError）=401
//   - 保存先: customerId あり=pathAiFeedback（顧客サブコレクション）/ なし=WS 直下 ai_chat_feedback
//   - rating は正なら +1・それ以外は -1 に正規化
//   - **Day101 の修正（privacy 実バグ）**: グローバル寄与は source が 'reply' | 'message' の時だけ。
//     読み出し側（getGlobalSuccessPatterns / getAggregateHint）は この2つしか引かないため、
//     'chat'（AI 経営アシスタントの回答＝売上・顧客名・メモを含む長文）を書いても
//     誰も読まないまま横断コレクションに残るだけだった。
//   - **Day101 の修正（パス injection）**: 集計キーに `/` が混じると別 doc を書き換え得るため、
//     危険なキーは集計だけスキップ（パターン保存とレスポンスは維持）。
//   - グローバル寄与は原文を保存せず伏字化テキストのみ・2000字上限。
//   - opt-in していない WS では横断コレクションへ一切書かない。
//   - 横断書き込みの失敗は握り潰して ok:true（フィードバック自体は成功扱い）。

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  getDb: vi.fn(),
  add: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({
  resolveAccessContext: mocks.resolve,
  pathAiFeedback: (_ctx: unknown, cid: string) => `customers/${cid}/ai_feedback`,
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__', increment: (n: number) => `__INC(${n})__` },
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/feedback/route';

/**
 * collection().add() と doc().set() をパス付きで捕捉するフェイク Firestore。
 * ws = shop_shops/{wid} の doc データ（null で不在）。
 */
function makeDb(ws: Record<string, unknown> | null, opts: { addThrowsOnGlobal?: boolean } = {}) {
  return {
    collection: (path: string) => ({
      add: async (payload: Record<string, unknown>) => {
        if (opts.addThrowsOnGlobal && path.startsWith('ai_knowledge')) {
          throw new Error('permission denied');
        }
        mocks.add(path, payload);
        return { id: 'gen1' };
      },
    }),
    doc: (path: string) => ({
      get: async () => ({ exists: ws !== null, data: () => ws }),
      set: async (payload: Record<string, unknown>, options: unknown) => {
        mocks.set(path, payload, options);
      },
    }),
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  workspaceId: 'w1',
  source: 'reply',
  rating: 1,
  output: 'また来てくださいね😊',
  ...over,
});
const makeReq = (payload: unknown) => ({ json: async () => payload }) as never;

/** mocks.add の呼び出しから、指定プレフィックスのものを取り出す */
function addsTo(prefix: string) {
  return mocks.add.mock.calls.filter((c) => String(c[0]).startsWith(prefix));
}

describe('ai/feedback POST（👍/👎 の記録とワークスペース横断の匿名化寄与）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ aiContribution: true, storeType: 'lounge' }));
    mocks.add.mockReset();
    mocks.set.mockReset();
  });

  it('workspaceId / source / rating(number) が欠けたら 400（書き込みなし）', async () => {
    for (const over of [{ workspaceId: '' }, { source: '' }, { rating: '1' }, { rating: undefined }]) {
      const res = await POST(makeReq(body(over)));
      expect(res.status).toBe(400);
    }
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('body が不正 JSON でも 500 にせず 400（防御済み request.json）', async () => {
    const res = await POST({ json: async () => { throw new Error('bad json'); } } as never);
    expect(res.status).toBe(400);
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await POST(makeReq(body()))).status).toBe(401);
  });

  it('本文が 1MB を超えたら 413（保存前に弾く・doc 上限エラーの 500 を防ぐ）', async () => {
    const res = await POST(makeReq(body({ output: 'あ'.repeat(400_000) })));
    expect(res.status).toBe(413);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('customerId ありは顧客サブコレクション、なしは WS 直下 ai_chat_feedback に保存', async () => {
    await POST(makeReq(body({ customerId: 'c9', source: 'chat' })));
    expect(addsTo('customers/c9/ai_feedback')).toHaveLength(1);

    mocks.add.mockReset();
    await POST(makeReq(body({ source: 'chat' })));
    expect(addsTo('shop_shops/w1/ai_chat_feedback')).toHaveLength(1);
  });

  it('rating は正なら +1・0/負なら -1 に正規化して保存', async () => {
    await POST(makeReq(body({ rating: 5, source: 'chat' })));
    await POST(makeReq(body({ rating: 0, source: 'chat' })));
    await POST(makeReq(body({ rating: -3, source: 'chat' })));
    const ratings = addsTo('shop_shops/w1/ai_chat_feedback').map((c) => c[1].rating);
    expect(ratings).toEqual([1, -1, -1]);
  });

  it('threadId / messageTs / scene / notes を保存し、messageTs は数値以外を null 化', async () => {
    await POST(makeReq(body({
      source: 'chat', threadId: 't1', messageTs: 'いつか', scene: 'ai_assistant', notes: 'ずれてた',
    })));
    const [, payload] = addsTo('shop_shops/w1/ai_chat_feedback')[0];
    expect(payload).toMatchObject({
      uid: 'u1', source: 'chat', threadId: 't1', messageTs: null, scene: 'ai_assistant', notes: 'ずれてた',
    });
  });

  // ---- Day101: ワークスペース横断コレクションへの寄与範囲（privacy 実バグの回帰） ----

  it('source=reply は opt-in 時にグローバル寄与する（伏字化テキストのみ・原文は保存しない）', async () => {
    await POST(makeReq(body({ source: 'reply', scene: 'thanks', output: '090-1234-5678 に連絡ください' })));
    const entries = addsTo('ai_knowledge/patterns/entries');
    expect(entries).toHaveLength(1);
    const payload = entries[0][1] as Record<string, unknown>;
    expect(payload.sanitizedOutput).not.toContain('090-1234-5678');
    expect(String(payload.sanitizedOutput)).toContain('[PHONE]');
    expect(payload).toMatchObject({ source: 'reply', scene: 'thanks', storeType: 'lounge', rating: 1 });
    // 紐付け情報は載せない
    expect(payload).not.toHaveProperty('workspaceId');
    expect(payload).not.toHaveProperty('uid');
    expect(payload).not.toHaveProperty('customerId');
    // 集計カウンターも 1 件
    expect(mocks.set).toHaveBeenCalledWith(
      'ai_knowledge/aggregates/buckets/reply_thanks_lounge_up',
      expect.objectContaining({ count: '__INC(1)__' }),
      { merge: true },
    );
  });

  it('source=message も寄与する / scene 未指定は generic 扱い', async () => {
    await POST(makeReq(body({ source: 'message' })));
    expect(addsTo('ai_knowledge/patterns/entries')).toHaveLength(1);
    expect(mocks.set.mock.calls[0][0]).toBe('ai_knowledge/aggregates/buckets/message_generic_lounge_up');
  });

  it('source=chat はグローバル寄与しない（横断コレクションへ売上・顧客名を出さない）', async () => {
    await POST(makeReq(body({ source: 'chat', scene: 'ai_assistant', output: '今月の売上は¥1,200,000。田中様が最多来店です。' })));
    expect(addsTo('ai_knowledge/patterns/entries')).toHaveLength(0);
    expect(mocks.set).not.toHaveBeenCalled();
    // ワークスペース内の記録は従来どおり残る
    expect(addsTo('shop_shops/w1/ai_chat_feedback')).toHaveLength(1);
  });

  it('未知の source もグローバル寄与しない（allowlist 方式）', async () => {
    await POST(makeReq(body({ source: 'seating' })));
    expect(addsTo('ai_knowledge')).toHaveLength(0);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('opt-in していない WS / WS doc 不在では横断コレクションへ書かない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ aiContribution: false, storeType: 'lounge' }));
    await POST(makeReq(body()));
    mocks.getDb.mockReturnValue(makeDb(null));
    await POST(makeReq(body()));
    expect(addsTo('ai_knowledge')).toHaveLength(0);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('output が空/空白のみなら寄与しない（伏字化しても中身がない）', async () => {
    await POST(makeReq(body({ output: '   ' })));
    expect(addsTo('ai_knowledge')).toHaveLength(0);
  });

  it('集計キーに `/` が混じる scene では集計をスキップ（別 doc の書き換えを防ぐ）', async () => {
    const res = await POST(makeReq(body({ scene: '../../shop_shops/w2/customers/c1' })));
    expect(res.status).toBe(200);
    // パターン保存は行われるが、集計 doc への書き込みはしない
    expect(addsTo('ai_knowledge/patterns/entries')).toHaveLength(1);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('伏字化テキストは 2000 字で打ち切る（他ワークスペースのプロンプトに載るため）', async () => {
    await POST(makeReq(body({ output: 'ん'.repeat(5000) })));
    const payload = addsTo('ai_knowledge/patterns/entries')[0][1] as Record<string, unknown>;
    expect(String(payload.sanitizedOutput)).toHaveLength(2000);
  });

  it('横断書き込みが失敗してもフィードバック自体は成功（ok:true）', async () => {
    mocks.getDb.mockReturnValue(
      makeDb({ aiContribution: true, storeType: 'lounge' }, { addThrowsOnGlobal: true }),
    );
    const res = await POST(makeReq(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ワークスペース横断コレクション（ai_knowledge/*）への書き出し口の網羅ガード（Day101）。
//
// Day99 の PII マスク網羅ガードと同じ発想。`ai_knowledge/*` は workspaceId を保存しない
// 共有コレクションで、書いた内容は他ワークスペースのプロンプトに載る（ai/message・message/reply）。
// 新しい route が横断コレクションへ書き始めても誰も気づかない、という構造を止める。
describe('ai_knowledge（ワークスペース横断）への書き出し口', () => {
  const API_ROOT = join(process.cwd(), 'src/app/api');

  function listRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listRouteFiles(full));
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  }

  const writers = listRouteFiles(API_ROOT)
    .filter((f) => /ai_knowledge/.test(stripComments(readFileSync(f, 'utf-8'))))
    .map((f) => relative(API_ROOT, f).split(/[\\/]/).join('/'))
    .sort();

  it('書き出し口は ai/feedback だけ（新しい route が増えたらここで落ちる）', () => {
    expect(writers).toEqual(['ai/feedback/route.ts']);
  });

  it('書き出し口は伏字化（sanitizePii）と source allowlist を通している', () => {
    const src = stripComments(readFileSync(join(API_ROOT, 'ai/feedback/route.ts'), 'utf-8'));
    expect(src).toMatch(/sanitizePii\(/);
    expect(src).toMatch(/CONTRIBUTABLE_SOURCES\.has\(/);
  });
});
