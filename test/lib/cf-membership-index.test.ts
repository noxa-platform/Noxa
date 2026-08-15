import { describe, it, expect, beforeEach, vi } from 'vitest';

// 逆引き index（`account_users/{uid}/memberships`）の**書き込み側**を固定する（Day121）。
//
// この index は「自分が所属する全店舗」の唯一の引き口で、いまや 3 系統が乗っている:
//   ホームの店舗切替（useWorkspaces）／共有端末の許可判定（Day113）／通知の対象店舗（Day120）。
// 正本は `shop_shops/{shopId}/members/{uid}`。**index が「所属している」と言うのに正本が無い**状態は、
// 画面では permission-denied（開けない店が並ぶ）、通知では Admin SDK なので**届いてしまう**という
// いちばん分かりにくい壊れ方をする。
//
// 見つかった実バグ:
//   ①店舗 doc を消してもサブコレクション（members）は残るため、members の削除トリガーは発火せず、
//     **消した店舗の逆引きが全メンバーに残り続ける**（`account/delete` のオーナー退会がこの経路）。
//   ②`mergeAccounts` の member 移管は `collectionGroup('members').where('uid','==',B)` だが、
//     member doc を書く 2 経路はどちらも **uid フィールドを書かない**＝常に 0 件。
//     index だけが統合先へ移り、「index では所属・rules では非メンバー」を作っていた。

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db, getAdminApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => ({ __increment: n }) },
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));

import { cleanupMembershipIndexOnShopDelete, syncShopNameToMemberships } from '../../functions/src/v2-sync';
import { listMemberShopIds } from '../../functions/src/merge';

type Doc = Record<string, unknown>;

/** collection().get() / doc().get()/delete() / batch() / collectionGroup() を持つ最小フェイク */
function makeDb(
  collections: Record<string, Record<string, Doc>>,
  opts: { failCommit?: boolean; failCollectionGroup?: boolean } = {},
) {
  const deleted: string[] = [];
  const commits: number[] = [];
  const rowsOf = (name: string) => Object.entries(collections[name] ?? {});
  const snapOf = (rows: { id: string; data: Doc; ref?: unknown }[]) => ({
    empty: rows.length === 0,
    docs: rows.map((r) => ({ id: r.id, data: () => r.data, ref: r.ref })),
  });
  const docRef = (path: string) => {
    const idx = path.lastIndexOf('/');
    const col = path.slice(0, idx);
    const id = path.slice(idx + 1);
    return {
      path,
      get: async () => ({ exists: collections[col]?.[id] !== undefined, data: () => collections[col]?.[id] }),
      set: async (d: Doc) => { (collections[col] ??= {})[id] = { ...(collections[col]?.[id] ?? {}), ...d }; },
      delete: async () => { deleted.push(path); delete collections[col]?.[id]; },
    };
  };
  const db = {
    collection: (name: string) => ({
      get: async () => snapOf(rowsOf(name).map(([id, data]) => ({ id, data }))),
      doc: (id: string) => docRef(`${name}/${id}`),
    }),
    doc: docRef,
    collectionGroup: (group: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => {
          if (opts.failCollectionGroup) throw new Error('index が要る');
          const rows: { id: string; data: Doc; ref: unknown }[] = [];
          for (const [colPath, docs] of Object.entries(collections)) {
            if (!colPath.endsWith(`/${group}`)) continue;
            const parentId = colPath.split('/').slice(-2)[0];
            for (const [id, data] of Object.entries(docs)) {
              if (data[field] === value) {
                rows.push({ id, data, ref: { parent: { parent: { id: parentId } } } });
              }
            }
          }
          return snapOf(rows);
        },
      }),
    }),
    batch: () => {
      const ops: { path: string; data?: Doc }[] = [];
      return {
        delete: (r: { path: string }) => { ops.push({ path: r.path }); },
        set: (r: { path: string }, d: Doc) => { ops.push({ path: r.path, data: d }); },
        commit: async () => {
          if (opts.failCommit) throw new Error('unavailable');
          commits.push(ops.length);
          for (const op of ops) {
            if (op.data) await docRef(op.path).set(op.data);
            else await docRef(op.path).delete();
          }
        },
      };
    },
  };
  return { db, deleted, commits };
}

const deleteEvent = (shopId: string) => ({
  params: { shopId },
  data: { before: { data: () => ({ name: '店A' }) }, after: { data: () => undefined } },
});
const updateEvent = (shopId: string) => ({
  params: { shopId },
  data: { before: { data: () => ({ name: '旧' }) }, after: { data: () => ({ name: '新' }) } },
});

const run = (e: unknown) =>
  (cleanupMembershipIndexOnShopDelete as unknown as (ev: unknown) => Promise<void>)(e);

describe('cleanupMembershipIndexOnShopDelete（消した店舗を所属に残さない）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('★店舗削除で全メンバーの逆引き index を消す（旧実装は掃除する経路が無かった）', async () => {
    const { db, deleted } = makeDb({
      'shop_shops/s1/members': { own1: { role: 'owner' }, mgr1: { role: 'manager' }, cast1: { role: 'cast' } },
      'account_users/own1/memberships': { s1: { shopId: 's1' } },
      'account_users/mgr1/memberships': { s1: { shopId: 's1' } },
      'account_users/cast1/memberships': { s1: { shopId: 's1' }, s2: { shopId: 's2' } },
    });
    mocks.db.mockReturnValue(db);

    await run(deleteEvent('s1'));

    expect(deleted.sort()).toEqual([
      'account_users/cast1/memberships/s1',
      'account_users/mgr1/memberships/s1',
      'account_users/own1/memberships/s1',
    ]);
  });

  it('別店舗の所属は消さない（掃除しすぎない）', async () => {
    const collections = {
      'shop_shops/s1/members': { cast1: { role: 'cast' } },
      'account_users/cast1/memberships': { s1: { shopId: 's1' }, s2: { shopId: 's2' } },
    };
    const { db } = makeDb(collections);
    mocks.db.mockReturnValue(db);

    await run(deleteEvent('s1'));

    expect(Object.keys(collections['account_users/cast1/memberships'])).toEqual(['s2']);
  });

  it('削除以外の書き込み（名前変更など）では何もしない', async () => {
    const { db, deleted } = makeDb({
      'shop_shops/s1/members': { mgr1: { role: 'manager' } },
      'account_users/mgr1/memberships': { s1: { shopId: 's1' } },
    });
    mocks.db.mockReturnValue(db);

    await run(updateEvent('s1'));

    expect(deleted).toEqual([]);
  });

  it('★掃除に失敗したら投げる（「消えた店が残っている」を無音にしない）', async () => {
    const { db } = makeDb(
      { 'shop_shops/s1/members': { mgr1: { role: 'manager' } } },
      { failCommit: true },
    );
    mocks.db.mockReturnValue(db);

    await expect(run(deleteEvent('s1'))).rejects.toThrow();
  });

  it('メンバーが 500 人を超えても batch 上限で落ちない（分割コミット）', async () => {
    const members: Record<string, Doc> = {};
    const collections: Record<string, Record<string, Doc>> = { 'shop_shops/s1/members': members };
    for (let i = 0; i < 900; i += 1) {
      members[`u${i}`] = { role: 'cast' };
      collections[`account_users/u${i}/memberships`] = { s1: { shopId: 's1' } };
    }
    const { db, commits, deleted } = makeDb(collections);
    mocks.db.mockReturnValue(db);

    await run(deleteEvent('s1'));

    expect(commits).toEqual([400, 400, 100]);
    expect(deleted).toHaveLength(900);
  });
});

describe('syncShopNameToMemberships（同型の横展開・500 件上限）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  const renameEvent = (shopId: string) => ({
    params: { shopId },
    data: { before: { data: () => ({ name: '旧店名' }) }, after: { data: () => ({ name: '新店名' }) } },
  });
  const runRename = (e: unknown) =>
    (syncShopNameToMemberships as unknown as (ev: unknown) => Promise<void>)(e);

  it('★メンバーが 500 人を超えても店舗名を反映できる（丸ごと失敗しない）', async () => {
    const members: Record<string, Doc> = {};
    const collections: Record<string, Record<string, Doc>> = { 'shop_shops/s1/members': members };
    for (let i = 0; i < 900; i += 1) {
      members[`u${i}`] = { role: 'cast' };
      collections[`account_users/u${i}/memberships`] = { s1: { shopId: 's1', shopName: '旧店名' } };
    }
    const { db, commits } = makeDb(collections);
    mocks.db.mockReturnValue(db);

    await runRename(renameEvent('s1'));

    expect(commits).toEqual([400, 400, 100]);
    expect(collections['account_users/u899/memberships'].s1).toMatchObject({ shopName: '新店名' });
  });

  it('名前が変わっていなければ何もしない', async () => {
    const { db, commits } = makeDb({ 'shop_shops/s1/members': { u1: {} } });
    mocks.db.mockReturnValue(db);

    await runRename({
      params: { shopId: 's1' },
      data: { before: { data: () => ({ name: '同じ' }) }, after: { data: () => ({ name: '同じ' }) } },
    });

    expect(commits).toEqual([]);
  });
});

describe('listMemberShopIds（アカウント統合が正本を取りこぼさない）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('★uid フィールドを書かない member doc でも店舗を拾う（旧実装は常に 0 件）', async () => {
    // /store/new・redeem-invite が書く member doc には uid が無い
    const { db } = makeDb({
      shop_shops: { s1: { ownerUid: 'b' }, s2: { ownerUid: 'x' } },
      'shop_shops/s1/members': { b: { role: 'owner', joinedAt: '__ts__' } },
      'shop_shops/s2/members': { b: { role: 'cast', status: 'active' } },
      'account_users/b/memberships': {},
    });
    mocks.db.mockReturnValue(db);

    expect((await listMemberShopIds('b')).sort()).toEqual(['s1', 's2']);
  });

  it('逆引き index にしか無い店舗も拾う（親 doc が消えた店舗の member doc）', async () => {
    const { db } = makeDb({
      shop_shops: {},
      'account_users/b/memberships': { ghost: { shopId: 'ghost' } },
    });
    mocks.db.mockReturnValue(db);

    expect(await listMemberShopIds('b')).toEqual(['ghost']);
  });

  it('uid フィールドを持つ member doc（他クライアント由来）も拾い、重複しない', async () => {
    const { db } = makeDb({
      shop_shops: { s1: { ownerUid: 'x' } },
      'shop_shops/s1/members': { b: { role: 'cast', uid: 'b' } },
      'account_users/b/memberships': { s1: { shopId: 's1' } },
    });
    mocks.db.mockReturnValue(db);

    expect(await listMemberShopIds('b')).toEqual(['s1']);
  });

  it('collectionGroup が引けなくても他 2 系統で結論を出す（黙って 0 件にしない）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = makeDb(
      {
        shop_shops: { s1: { ownerUid: 'b' } },
        'shop_shops/s1/members': { b: { role: 'owner' } },
        'account_users/b/memberships': {},
      },
      { failCollectionGroup: true },
    );
    mocks.db.mockReturnValue(db);

    expect(await listMemberShopIds('b')).toEqual(['s1']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
