import { describe, it, expect, beforeEach, vi } from 'vitest';

// ai/briefing の POST を検証する（Day90）。
// 顧客1人を30秒で再把握する AI サマリ（withReservedCredits＝canonical 引当）。固定する挙動:
//   - workspaceId/customerId 欠落=400、認証401、越境（resolveAccessContext throw）=generic 500
//   - 成功: LLM 生 JSON をパースして briefing＋creditsRemaining を返し ack（=消費確定）
//   - パース失敗=500 かつ **ack しない**（＝withReservedCredits が refund する Day67 契約）
//
// P162（2026-08-29）で **取得結果を 3 状態に分けた**。それまでは
// 「顧客 doc が読めない」も「顧客が居ない」も `'{}'` を組み立ててモデルへ送っており、
// モデルが「特筆すべき情報が無い」と言い切って**利用者にはそれが答えとして見えていた**:
//   - blocked（読めない）= **500**・**generateText を呼ばない**（クレジットも予約しない）
//     ⚠️ **503 にしない**（P162-PM）。iOS は「ai/ のパス・503・本文を復号できた」で
//     **AI 全体の停止**と読む版が端末に残っており、顧客 1 人の失敗でアプリ全体が止まる。
//   - blocked（居ない）  = 404（**読めなかったのと同じ値に畳まない**）
//   - partial（一部だけ）= 200・プロンプトに断り文・応答 `incomplete: ['直近ログ']`
//   - ready（本当に 0 件）= 200・断り文なし・`incomplete: []`（**0 件でも必ず配列**）
//
// 顧客ログ orderBy は datetime（Day88 で正準確認済み）。実バグは発見されず。executable spec。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn(), gen: vi.fn(), ack: vi.fn() }));

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
// ack を spy で受けてパース失敗時に ack されない（=refund 契約）ことを検証する。
vi.mock('../../src/app/api/ai/with-credits', () => ({
  withReservedCredits: (
    _uid: string,
    _cost: number,
    fn: (h: { ack: () => void; remaining: number }) => Promise<unknown>,
  ) => fn({ ack: mocks.ack, remaining: 6 }),
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/ai/briefing/route';

function makeDb(
  customer: Record<string, unknown> | undefined,
  logs: Record<string, unknown>[] = [],
  fail: { customer?: boolean; logs?: boolean } = {},
) {
  return {
    doc: () => ({
      get: async () => {
        if (fail.customer) throw new Error('permission-denied');
        return { exists: customer !== undefined, data: () => customer };
      },
    }),
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => {
      if (fail.logs) throw new Error('deadline-exceeded');
      return { docs: logs.map((l) => ({ data: () => l })) };
    } }) }) }),
  };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const okBody = { workspaceId: 'w1', customerId: 'c1' };

describe('ai/briefing POST（会話前ブリーフィング）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ workspaceId: 'w1' });
    mocks.getDb.mockReset().mockReturnValue(makeDb({ name: '太郎', rank: 'VIP' }, [{ type: 'visit', datetime: { toDate: () => new Date('2026-07-01') } }]));
    mocks.gen.mockReset().mockResolvedValue('{"stage":"S3","topicCandidates":["旅行","猫","映画"]}');
    mocks.ack.mockReset();
  });

  it('workspaceId/customerId 欠落は 400', async () => {
    expect((await POST(req({ customerId: 'c1' }))).status).toBe(400);
    expect((await POST(req({ workspaceId: 'w1' }))).status).toBe(400);
    expect(mocks.gen).not.toHaveBeenCalled();
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

  it('成功: briefing をパースして返し ack（消費確定）する', async () => {
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      briefing: { stage: 'S3', topicCandidates: ['旅行', '猫', '映画'] },
      creditsRemaining: 6,
      incomplete: [],
    });
    expect(mocks.ack).toHaveBeenCalledTimes(1);
  });

  it('パース失敗は 500・ack しない（refund 契約）', async () => {
    mocks.gen.mockResolvedValue('JSONではない説明文');
    const res = await POST(req(okBody));
    expect(res.status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  // ---- P162: 取得結果の 3 状態 ----

  it('①顧客 doc が読めない: 500・モデルへ送らない・クレジットを消費しない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎' }, [], { customer: true }));
    const res = await POST(req(okBody));
    // 🔴 **503 ではない**。iOS が「AI 全体の停止」と読む版が端末に残っているため（P162-PM）
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('顧客データを取得できませんでした');
    // 🔴 ここが本題。'{}' を渡していた頃は 200 が返り、モデルが
    // 「特筆すべき情報が無い」と言い切って利用者に届いていた
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('①顧客が居ない: 404（「読めなかった」と同じ値に畳まない）', async () => {
    mocks.getDb.mockReturnValue(makeDb(undefined, []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(404);
    expect(mocks.gen).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('②ログだけ読めない: 200 で送るが、断り文を渡し incomplete で名指しする', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '太郎', rank: 'VIP' }, [], { logs: true }));
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      briefing: { stage: 'S3', topicCandidates: ['旅行', '猫', '映画'] },
      creditsRemaining: 6,
      incomplete: ['直近ログ'],
    });
    // 止めない（記録が 1 件でも欠けた顧客で AI が死ぬ）が、黙って送らない
    const sent = String(mocks.gen.mock.calls[0][0]);
    expect(sent).toContain('直近ログ');
    expect(sent).toContain('取得できませんでした');
    // 読めた側（顧客本体）はちゃんと届いている
    expect(sent).toContain('太郎');
  });

  it('③本当に 0 件: 200・断り文なし・incomplete は空配列（新規顧客を塞がない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ name: '新規太郎' }, []));
    const res = await POST(req(okBody));
    expect(res.status).toBe(200);
    expect((await res.json()).incomplete).toEqual([]);
    const sent = String(mocks.gen.mock.calls[0][0]);
    expect(sent).not.toContain('取得できませんでした');
    expect(sent).toContain('新規太郎');
  });

  it('【回帰・Day99】顧客とログのフリーテキストは maskDeep されて AI に渡る', async () => {
    mocks.getDb.mockReturnValue(makeDb(
      { name: '太郎', likesNote: 'TEL 090-1234-5678', importantMemo: 'a@b.com' },
      [{ type: 'visit', memo: '同伴 080-9999-8888', place: '店' }],
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
