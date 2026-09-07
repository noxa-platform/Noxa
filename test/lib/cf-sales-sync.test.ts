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
// ⚠️ **このモックは P166 まで一度も効いていなかった。**
// `functions/` は自分の `node_modules/firebase-admin` を持つため、`functions/src` からの
// `firebase-admin/firestore` はルートとは**別のファイルに解決**され、`vi.mock` の id と一致
// しなかった。テストは「差し替えたつもり」で本物の FieldValue を動かしたまま緑だった
//（`'__ts__'` を誰も assert していなかったので、嘘が表に出なかった）。
// vitest.config.ts の alias で解決先を 1 つに揃えたので、以降このモックは実際に効く。
// ⇒ 差し替えるなら**使っている export を全部**置くこと（Timestamp が欠けていた）。
vi.mock('firebase-admin/firestore', () => {
  // ⚠️ factory は先頭へ巻き上げられるので、クラスは**この中で**定義する
  class FakeTimestamp {
    constructor(readonly ms: number) {}
    static fromMillis(ms: number) { return new FakeTimestamp(ms); }
    static fromDate(d: Date) { return new FakeTimestamp(d.getTime()); }
    toMillis() { return this.ms; }
  }
  return {
    FieldValue: {
      serverTimestamp: () => '__ts__',
      increment: (n: number) => ({ __increment: n }),
    },
    Timestamp: FakeTimestamp,
  };
});

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

describe('控え・台帳へ書く時刻を Timestamp に揃える（P166）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  /** FakeTimestamp（factory 内で定義しているので、判定は形で行う） */
  const asMillis = (v: unknown): number | undefined =>
    typeof (v as { toMillis?: () => number })?.toMillis === 'function'
      ? (v as { toMillis: () => number }).toMillis()
      : undefined;

  it('正常な Timestamp はそのまま書く（余計な変換をしない）', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);
    const stamp = { toMillis: () => 1_700_000_000_000 };

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, checkoutAt: stamp }),
    );

    // instanceof は通らないが toMillis 経由で同じミリ秒に落ちる（値が化けない）ことを見る
    expect(asMillis(store['personal_sales/cast1/items/sale1'].datetime)).toBe(1_700_000_000_000);
  });

  /**
   * 🔴 旧実装は `after.checkoutAt ?? after.createdAt ?? serverTimestamp()` で、
   * **売上 doc に入っていた形をそのまま書き写していた**。number のまま控えへ入ると
   * 日次サマリの範囲クエリ（`where('datetime','>=',Timestamp)`）に**型が違って一致しない**。
   * ⚠️ この一致しない挙動は最小フェイクでは再現できない（フェイクは Number() で比較する）。
   * だからここでは**書かれた値の形**を見る——それが実 Firestore で効く唯一の条件。
   */
  it('★number（ミリ秒）で来た checkoutAt を Timestamp に変換してから書く', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, checkoutAt: 1_700_000_000_000 }),
    );

    const written = store['personal_sales/cast1/items/sale1'].datetime;
    expect(typeof written).not.toBe('number');
    expect(asMillis(written)).toBe(1_700_000_000_000);
  });

  it('★ISO 文字列で来た checkoutAt も Timestamp に揃える', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, checkoutAt: '2026-08-26T03:00:00.000Z' }),
    );

    expect(asMillis(store['personal_sales/cast1/items/sale1'].datetime))
      .toBe(Date.parse('2026-08-26T03:00:00.000Z'));
  });

  /**
   * ⚠️ 旧実装は `??` なので、**壊れた checkoutAt が有効な createdAt を隠していた**
   *（null / undefined でなければ `??` は次へ行かない）。
   */
  it('★読めない checkoutAt は、有効な createdAt を隠さない', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, checkoutAt: true, createdAt: 1_700_000_000_000 }),
    );

    expect(asMillis(store['personal_sales/cast1/items/sale1'].datetime)).toBe(1_700_000_000_000);
  });

  it('どちらも読めなければサーバ時刻へ倒す（壊れた値をそのまま保存しない）', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, checkoutAt: {}, createdAt: 'いつか' }),
    );

    expect(store['personal_sales/cast1/items/sale1'].datetime).toBe('__ts__');
  });

  /**
   * 顧客ありの経路（担当台帳）は `lastContactAt` にも同じ値が入る。
   * ここが number のままだと、通知側（`listCustomers`）が読む形が壊れる＝P166 の読み手側と対。
   */
  it('★顧客あり売上でも lastContactAt / ログの datetime が Timestamp で入る', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, customerId: 'c1', checkoutAt: 1_700_000_000_000 }),
    );

    const cust = store['personal_customers/cast1/items/c1'];
    const log = store['personal_customers/cast1/items/c1/logs/sale1'];
    expect(asMillis(cust.lastContactAt)).toBe(1_700_000_000_000);
    expect(asMillis(log.datetime)).toBe(1_700_000_000_000);
  });

  /**
   * ⚠️ `num()` を共通化したときに **NaN の扱いが変わった**（旧: `typeof v === 'number'` だけ
   * ＝ NaN も通す / 新: `Number.isFinite` で 0 に倒す）。金額の経路なので固定しておく。
   * NaN を通すと `increment(NaN)` で**台帳の合計が二度と戻らない NaN に汚染される**。
   */
  it('★NaN の金額は 0 に倒す（increment(NaN) で台帳を汚染しない）', async () => {
    const { db, store } = makeDb({ store: { 'account_users/cast1': {} } });
    mocks.db.mockReturnValue(db);

    await (syncShopSaleToPersonal as unknown as (e: unknown) => Promise<void>)(
      event({ ...SALE, amount: Number.NaN }),
    );

    expect(store['personal_sales/cast1/items/sale1']).toMatchObject({ salesAmount: 0, amount: 0 });
  });
});
