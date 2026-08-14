import { describe, it, expect, beforeEach, vi } from 'vitest';

// 通報の集計 → 自動非表示トリガー（`hideReportedContent`）の動作を固定する（Day119）。
// Day118 で「集計の失敗を通報ゼロと同じ扱いにしない」は静的ガードで止めたが、
// **閾値・重複排除・resolved の扱い**という肝心の判断は一度も動作で固定していなかった。
// ここが崩れると ①荒らしが放置される ②逆に管理者の unhide が即座に無効化される、の両方が起きる。

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => ({ __increment: n }) },
}));

import { hideReportedContent } from '../../functions/src/community-moderation';

type Doc = Record<string, unknown>;
type Report = Doc & { id: string };

function makeDb(opts: { target?: Doc | null; targetPath?: string; reports?: Report[]; failReports?: boolean }) {
  const targetPath = opts.targetPath ?? 'noxa_posts/t1';
  const written: Doc[] = [];
  const db = {
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: path === targetPath && !!opts.target, data: () => opts.target ?? undefined }),
      set: async (d: Doc) => { if (path === targetPath) written.push(d); },
    }),
    collection: () => {
      const chain = {
        where: () => chain,
        get: async () => {
          if (opts.failReports) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
          return { docs: (opts.reports ?? []).map(({ id, ...rest }) => ({ id, data: () => rest })) };
        },
      };
      return chain;
    },
  };
  return { db, written };
}

const event = (data: Doc) => ({ data: { data: () => data } });
const REPORT = { targetType: 'thread', targetId: 't1' };
const call = (e: unknown) => (hideReportedContent as unknown as (e: unknown) => Promise<void>)(e);

describe('hideReportedContent（自動非表示の判断）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('異なる通報者が3人に達したら非表示にする', async () => {
    const { db, written } = makeDb({
      target: { body: '荒らし' },
      reports: [
        { id: 'r1', reporterUid: 'a' },
        { id: 'r2', reporterUid: 'b' },
        { id: 'r3', reporterUid: 'c' },
      ],
    });
    mocks.db.mockReturnValue(db);

    await call(event(REPORT));

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ reportCount: 3, hidden: true });
  });

  it('★同一人物の連打では非表示にしない（通報者で重複排除）', async () => {
    const { db, written } = makeDb({
      target: { body: '普通の投稿' },
      reports: [
        { id: 'r1', reporterUid: 'a' },
        { id: 'r2', reporterUid: 'a' },
        { id: 'r3', reporterUid: 'a' },
      ],
    });
    mocks.db.mockReturnValue(db);

    await call(event(REPORT));

    expect(written[0]).toMatchObject({ reportCount: 1 });
    expect(written[0]).not.toHaveProperty('hidden'); // 1 人では隠さない
  });

  it('★解決済み（resolved）の通報は数えない（管理者の unhide を無力化しない）', async () => {
    const { db, written } = makeDb({
      target: { body: '解除済みの投稿' },
      reports: [
        { id: 'r1', reporterUid: 'a', status: 'resolved' },
        { id: 'r2', reporterUid: 'b', status: 'resolved' },
        { id: 'r3', reporterUid: 'c' }, // 新規の1件だけが有効
      ],
    });
    mocks.db.mockReturnValue(db);

    await call(event(REPORT));

    expect(written[0]).toMatchObject({ reportCount: 1 });
    expect(written[0]).not.toHaveProperty('hidden');
  });

  it('status 欠落（旧 doc / iOS）は open として数える', async () => {
    const { db, written } = makeDb({
      target: { body: 'x' },
      reports: [{ id: 'r1', reporterUid: 'a' }, { id: 'r2', reporterUid: 'b' }, { id: 'r3', reporterUid: 'c', status: undefined }],
    });
    mocks.db.mockReturnValue(db);

    await call(event(REPORT));

    expect(written[0]).toMatchObject({ reportCount: 3, hidden: true });
  });

  it('既に非表示・削除済みの対象には書き込まない（無駄な再計算をしない）', async () => {
    const hidden = makeDb({ target: { hidden: true }, reports: [{ id: 'r1', reporterUid: 'a' }] });
    mocks.db.mockReturnValue(hidden.db);
    await call(event(REPORT));
    expect(hidden.written).toHaveLength(0);

    const gone = makeDb({ target: null, reports: [{ id: 'r1', reporterUid: 'a' }] });
    mocks.db.mockReturnValue(gone.db);
    await call(event(REPORT));
    expect(gone.written).toHaveLength(0);
  });

  it('reply の通報は noxa_comments を見る（対象の取り違えをしない）', async () => {
    const { db, written } = makeDb({
      targetPath: 'noxa_comments/c1',
      target: { body: 'コメント' },
      reports: [{ id: 'r1', reporterUid: 'a' }, { id: 'r2', reporterUid: 'b' }, { id: 'r3', reporterUid: 'c' }],
    });
    mocks.db.mockReturnValue(db);

    await call(event({ targetType: 'reply', targetId: 'c1' }));

    expect(written[0]).toMatchObject({ reportCount: 3, hidden: true });
  });

  it('★通報の集計に失敗したら「通報ゼロ」として素通りせず throw する（Day118 の修正の動作確認）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db, written } = makeDb({ target: { body: 'x' }, failReports: true });
      mocks.db.mockReturnValue(db);

      await expect(call(event(REPORT))).rejects.toThrow();
      expect(written).toHaveLength(0); // reportCount を 0 で上書きしない
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
