import { describe, it, expect, beforeEach, vi } from 'vitest';

// 店舗売上 → キャスト個人データの同期トリガー（`syncShopSaleToPersonal`）の
// **失敗時のふるまい**を固定する（Day118）。CF は今週まで一度も走査していなかった面。
//
// この投影が落ちると、キャストの個人売上・担当台帳が欠ける＝成績と給与の材料が欠ける。
// 旧実装は
//   - `account_users` の確認に失敗したら false（＝投影対象外の uid）扱いにして**丸ごとスキップし正常終了**
//   - 控えの掃除に失敗しても `.catch(() => undefined)` で握り潰し（顧客ログと控えが二重に残る）
// となっており、どちらも**ログにも実行結果にも残らない**（本番でだけ起きる一時障害で発生する）。

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    increment: (n: number) => ({ __increment: n }),
  },
}));

import { syncShopSaleToPersonal } from '../../functions/src/sales-sync';

type Doc = Record<string, unknown>;

/** doc().get()/set()/delete() と runTransaction を持つ最小フェイク（失敗させたいパスを指定できる） */
function makeDb(opts: { store?: Record<string, Doc>; failGet?: string[]; failDelete?: string[] } = {}) {
  const store: Record<string, Doc> = { ...opts.store };
  const failGet = new Set(opts.failGet ?? []);
  const failDelete = new Set(opts.failDelete ?? []);
  const deleted: string[] = [];
  const written: Record<string, Doc> = {};
  const ref = (path: string) => ({
    path,
    get: async () => {
      if (failGet.has(path)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      return { exists: store[path] !== undefined, data: () => store[path] };
    },
    set: async (d: Doc) => { written[path] = { ...(written[path] ?? {}), ...d }; store[path] = { ...(store[path] ?? {}), ...d }; },
    delete: async () => {
      if (failDelete.has(path)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      deleted.push(path);
      delete store[path];
    },
  });
  const db = {
    doc: ref,
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async (r: { path: string }) => ref(r.path).get(),
        set: async (r: { path: string }, d: Doc) => ref(r.path).set(d),
        delete: (r: { path: string }) => { deleted.push(r.path); delete store[r.path]; },
      };
      await fn(tx);
    },
  };
  return { db, store, written, deleted };
}

const event = (after: Doc | undefined, before?: Doc) => ({
  params: { shopId: 's1', saleId: 'sale1' },
  data: {
    before: { data: () => before },
    after: { data: () => after },
  },
});

const SALE = { castUid: 'cast1', amount: 12000, dayKey: '2026-08-15', customerName: 'A様' };

describe('syncShopSaleToPersonal（売上投影の失敗を無音にしない）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('通常: 顧客なし売上は personal_sales へ控えを書く', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event(SALE));

    expect(store['personal_sales/cast1/items/sale1']).toMatchObject({ salesAmount: 12000, amount: 12000, shopId: 's1' });
  });

  it('★account_users の確認に失敗したら投影を飛ばして成功扱いにしない（throw して記録・再試行させる）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db, store } = makeDb({ store: { 'account_users/cast1': {} }, failGet: ['account_users/cast1'] });
      mocks.db.mockReturnValue(db);

      // 旧実装はここで resolve し、**控えを書かないまま正常終了**していた
      await expect((syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event(SALE))).rejects.toThrow();
      expect(store['personal_sales/cast1/items/sale1']).toBeUndefined();
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('端末など account_users が無い uid は従来どおり投影しない（存在しない、は確定的な否定）', async () => {
    const { db, store } = makeDb({ store: {} }); // account_users/cast1 が無い
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event(SALE));

    expect(store['personal_sales/cast1/items/sale1']).toBeUndefined();
  });

  it('★取消（voided）で控えを消せなかったら握り潰さない（幻の売上が個人側に残る）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db } = makeDb({
        store: { 'account_users/cast1': {}, 'personal_sales/cast1/items/sale1': { salesAmount: 12000 } },
        failDelete: ['personal_sales/cast1/items/sale1'],
      });
      mocks.db.mockReturnValue(db);

      await expect(
        (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event({ ...SALE, voided: true }, SALE)),
      ).rejects.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('取消が正常に処理できたときは控えが消える（通常経路の回帰防止）', async () => {
    const { db, store } = makeDb({
      store: { 'account_users/cast1': {}, 'personal_sales/cast1/items/sale1': { salesAmount: 12000 } },
    });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event({ ...SALE, voided: true }, SALE));

    expect(store['personal_sales/cast1/items/sale1']).toBeUndefined();
  });

  it('★顧客あり売上で旧控えを消せなかったら二重計上のまま黙らない', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { db } = makeDb({
        store: {
          'account_users/cast1': {},
          'personal_sales/cast1/items/sale1': { salesAmount: 12000 }, // 顧客なし時代の控え
        },
        failDelete: ['personal_sales/cast1/items/sale1'],
      });
      mocks.db.mockReturnValue(db);

      // 顧客ログ（member-stats が集計）と控え（同じく集計）が両方残ると売上が二重に見える
      await expect(
        (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(event({ ...SALE, customerId: 'cus1' })),
      ).rejects.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
