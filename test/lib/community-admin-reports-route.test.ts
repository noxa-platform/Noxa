import { describe, it, expect, beforeEach, vi } from 'vitest';

// community/admin/reports の POST を Admin SDK モック＋フェイク Firestore で検証する（Day79）。
// 通報一覧（admin 専用）の集約ロジックを固定する:
//   - admin ゲート（非 admin=403 / トークン不正=401）
//   - 対象ごと集約: reporterUid を Set で重複排除・reportIds 収集・open フラグ
//   - onlyOpen（既定）: status≠open の通報を除外／status:'all' で全件
//   - 対象プレビュー（thread→noxa_posts【title】body80 / reply→noxa_comments）・削除済み='(削除済み)'
//   - reportCount は対象 doc の値優先・無ければ通報者数・reporters 降順ソート・不正 doc スキップ

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/community/admin/reports/route';

/** doc.get()＋collection('noxa_reports').orderBy().limit().get() 対応の最小フェイク。 */
function makeDb(opts: {
  account?: Record<string, Record<string, unknown>>;
  docs?: Record<string, Record<string, unknown>>;
  reports?: Array<Record<string, unknown> & { id: string }>;
  /** get() が失敗するパス（インデックス欠落・タイムアウト・一時障害の再現・Day116-PM） */
  failDocs?: string[];
} = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...opts.account, ...opts.docs };
  const failing = new Set(opts.failDocs ?? []);
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const reportDocs = (opts.reports ?? []).map((r) => {
    const { id, ...rest } = r;
    return { id, data: () => rest };
  });
  const db = {
    doc: (p: string) => ({
      path: p,
      get: async () => {
        if (failing.has(p)) throw new Error(`unavailable: ${p}`);
        return snap(p);
      },
    }),
    collection: (name: string) => {
      const chain = {
        orderBy: () => chain,
        limit: () => chain,
        get: async () => ({ docs: name === 'noxa_reports' ? reportDocs : [] }),
      };
      return chain;
    },
  };
  return { db, store };
}
const req = (body: unknown = {}) => ({ json: async () => body }) as never;
const ADMIN = { 'account_users/admin1': { platformRole: 'admin' } };
type Item = { targetType: string; targetId: string; postId: string; preview: string; exists: boolean; fetchFailed?: boolean; hidden: boolean; reportCount: number; reporters: number; reportIds: string[]; open: boolean };
const items = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()).items as Item[];

describe('community/admin/reports POST（通報一覧の集約と admin 境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('admin1');
    mocks.getDb.mockReset();
  });

  it('非 admin は 403 / トークン不正は 401', async () => {
    mocks.verify.mockResolvedValue('u1');
    mocks.getDb.mockReturnValue(makeDb({ account: { 'account_users/u1': { platformRole: 'user' } } }).db);
    expect((await POST(req())).status).toBe(403);

    mocks.verify.mockReset().mockRejectedValue(new AuthError('認証トークンが無効です'));
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req())).status).toBe(401);
  });

  it('対象ごと集約: reporterUid を重複排除・reportIds 収集・プレビュー/reportCount/hidden', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_posts/t1': { title: 'お知らせ', body: 'こんにちは世界', hidden: false, reportCount: 5 } },
      reports: [
        { id: 'r1', targetType: 'thread', targetId: 't1', reporterUid: 'u1', status: 'open' },
        { id: 'r2', targetType: 'thread', targetId: 't1', reporterUid: 'u1', status: 'open' }, // 同一通報者
        { id: 'r3', targetType: 'thread', targetId: 't1', reporterUid: 'u2', status: 'open' },
      ],
    }).db);
    const [it0] = await items(await POST(req()));
    expect(it0.targetType).toBe('thread');
    expect(it0.targetId).toBe('t1');
    expect(it0.preview).toBe('【お知らせ】こんにちは世界');
    expect(it0.reporters).toBe(2);          // u1 重複を排除
    expect(it0.reportIds).toEqual(['r1', 'r2', 'r3']); // 通報 doc は全部
    expect(it0.reportCount).toBe(5);        // 対象 doc の値優先
    expect(it0.hidden).toBe(false);
    expect(it0.exists).toBe(true);
    expect(it0.open).toBe(true);
  });

  it('onlyOpen（既定）は resolved を除外・resolved のみの対象は出さない', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_posts/t1': { body: 'x' }, 'noxa_posts/t2': { body: 'y' } },
      reports: [
        { id: 'r1', targetType: 'thread', targetId: 't1', reporterUid: 'u1', status: 'open' },
        { id: 'r2', targetType: 'thread', targetId: 't1', reporterUid: 'u2', status: 'resolved' },
        { id: 'r3', targetType: 'thread', targetId: 't2', reporterUid: 'u3', status: 'resolved' }, // resolved のみ
      ],
    }).db);
    const list = await items(await POST(req()));            // 既定=onlyOpen
    const t1 = list.find((i) => i.targetId === 't1')!;
    expect(t1.reportIds).toEqual(['r1']);                    // resolved r2 は除外
    expect(list.find((i) => i.targetId === 't2')).toBeUndefined(); // resolved のみは非表示
  });

  it("status:'all' は resolved も含める（resolved のみ対象も open=false で表示）", async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_posts/t2': { body: 'y' } },
      reports: [
        { id: 'r3', targetType: 'thread', targetId: 't2', reporterUid: 'u3', status: 'resolved' },
      ],
    }).db);
    const list = await items(await POST(req({ status: 'all' })));
    const t2 = list.find((i) => i.targetId === 't2')!;
    expect(t2.reportIds).toEqual(['r3']);
    expect(t2.open).toBe(false); // open な通報が無い
  });

  it('reply は noxa_comments を読む・削除済み対象は (削除済み) で reportCount は通報者数', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_comments/c1': { body: 'コメント本文' } }, // c1 は存在、tX は不在
      reports: [
        { id: 'r1', targetType: 'reply', targetId: 'c1', reporterUid: 'u1', status: 'open' },
        { id: 'r2', targetType: 'thread', targetId: 'tX', reporterUid: 'u9', status: 'open' }, // 対象 doc 無し
      ],
    }).db);
    const list = await items(await POST(req()));
    const c1 = list.find((i) => i.targetId === 'c1')!;
    expect(c1.preview).toBe('コメント本文');
    const tX = list.find((i) => i.targetId === 'tX')!;
    expect(tX.preview).toBe('(削除済み)');
    expect(tX.exists).toBe(false);
    expect(tX.reportCount).toBe(1); // 対象 doc 欠落→通報者数にフォールバック
  });

  it('reporters 降順でソート・不正 doc（targetId/targetType 欠落）はスキップ・postId は targetId フォールバック', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_posts/low': { body: 'a' }, 'noxa_posts/high': { body: 'b' } },
      reports: [
        { id: 'r1', targetType: 'thread', targetId: 'low', reporterUid: 'u1', status: 'open' },
        { id: 'r2', targetType: 'thread', targetId: 'high', reporterUid: 'u1', status: 'open' },
        { id: 'r3', targetType: 'thread', targetId: 'high', reporterUid: 'u2', status: 'open' },
        { id: 'r4', targetType: 'thread', targetId: 'high', reporterUid: 'u3', status: 'open' },
        { id: 'bad', reporterUid: 'u4', status: 'open' }, // targetId/targetType 欠落
      ],
    }).db);
    const list = await items(await POST(req()));
    expect(list.map((i) => i.targetId)).toEqual(['high', 'low']); // 通報者数の多い順
    expect(list.find((i) => i.targetId === 'high')!.postId).toBe('high'); // postId 欠落→targetId
    expect(list.some((i) => i.reportIds.includes('bad'))).toBe(false); // 不正 doc は無視
  });

  // Day116 は「取得失敗を削除済みと同一視しない」を実装したが、固定は静的な正規表現だけだった。
  // 実際に読み取りを落として、応答が区別できることを確かめる（Day116-PM）。
  it('★対象の取得に失敗したら fetchFailed=true・「削除済み」と別の文言で返す', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.getDb.mockReturnValue(makeDb({
        account: ADMIN,
        docs: { 'noxa_posts/ok1': { body: '残っている投稿' } },
        failDocs: ['noxa_posts/ng1'],
        reports: [
          { id: 'r1', targetType: 'thread', targetId: 'ng1', reporterUid: 'u1', status: 'open' },
          { id: 'r2', targetType: 'thread', targetId: 'ok1', reporterUid: 'u2', status: 'open' },
        ],
      }).db);

      const list = await items(await POST(req()));
      const ng = list.find((i) => i.targetId === 'ng1')!;
      expect(ng.fetchFailed).toBe(true);
      expect(ng.exists).toBe(false);              // 読めていないので中身は無い
      expect(ng.preview).toBe('(本文を取得できませんでした)'); // ここが '(削除済み)' だと運営が通報を閉じてしまう
      expect(ng.reportCount).toBe(1);             // 通報者数へフォールバック

      // 1件落ちても他の対象は通常どおり返る（Promise.all を巻き添えで落とさない）
      const ok = list.find((i) => i.targetId === 'ok1')!;
      expect(ok.fetchFailed).toBe(false);
      expect(ok.preview).toBe('残っている投稿');
      expect(spy).toHaveBeenCalled();             // 運用者が追える
    } finally { spy.mockRestore(); }
  });

  it('★本当に削除済みの対象は fetchFailed=false のまま（警告を出しっぱなしにしない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      reports: [{ id: 'r1', targetType: 'thread', targetId: 'gone', reporterUid: 'u1', status: 'open' }],
    }).db);
    const [it0] = await items(await POST(req()));
    expect(it0.fetchFailed).toBe(false);
    expect(it0.preview).toBe('(削除済み)');
  });

  it('hidden な対象は hidden=true を返す', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      account: ADMIN,
      docs: { 'noxa_posts/t1': { body: 'x', hidden: true } },
      reports: [{ id: 'r1', targetType: 'thread', targetId: 't1', reporterUid: 'u1', status: 'open' }],
    }).db);
    const [it0] = await items(await POST(req()));
    expect(it0.hidden).toBe(true);
  });
});
