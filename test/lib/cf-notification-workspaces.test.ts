import { describe, it, expect, beforeEach, vi } from 'vitest';

// 通知の**対象ワークスペース**（＝その uid の「何を見るか」）を固定する（Day120）。
//
// Day119 で「誰に送るか（uid の母集団）」は直したが、そこから先は未検証だった。
// 旧実装の実バグ:
//   `listOwnedWorkspaces` は `shop_shops.ownerUid == uid` ＋ MyDeck しか見ない。
//   招待で参加した店長は rules 上その店舗の顧客カルテを read/write できる
//   （`isShopMember` で全許可）のに、誕生日・次回アクション・ご無沙汰が**一度も来ない**。
//   さらに日次サマリは無条件送信なので、店長には毎朝
//   「前日: ¥0 / 0 組 / 今日の予定: 0 件」という**もっともらしい 0**が届いていた
//   （データが無いのではなく、見ている場所が違う＝偽の成功）。

const mocks = vi.hoisted(() => ({ db: vi.fn(), messaging: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db, messaging: mocks.messaging }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => ({ __increment: n }) },
  Timestamp: { fromDate: (d: Date) => ({ toMillis: () => d.getTime() }) },
}));

import { listUserWorkspaces, customersCollectionPath } from '../../functions/src/lib/workspaces';
import { runBirthdayReminder } from '../../functions/src/notifications/birthday';
import { runDailySummary } from '../../functions/src/notifications/daily-summary';
import { jstMonthDayDaysAhead, jstStartOfYesterday } from '../../functions/src/lib/datetime';

type Doc = Record<string, unknown>;
type Filter = { field: string; op: string; value: unknown };

/** Timestamp 相当（toMillis を持つ）。where 比較にも使う */
const ts = (d: Date) => ({ toMillis: () => d.getTime() });
const millis = (v: unknown): number =>
  typeof (v as { toMillis?: () => number })?.toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : Number(v);

/**
 * collection(path).where().get() / collection(path).doc(id).get() / doc(path).set() を持つ最小フェイク。
 * collections のキーはコレクションの**フルパス**（例 'shop_shops/s1/customers'）。
 */
function makeDb(
  collections: Record<string, Record<string, Doc>>,
  opts: { failCollections?: string[]; failDocs?: string[] } = {},
) {
  const fail = new Set(opts.failCollections ?? []);
  const failDoc = new Set(opts.failDocs ?? []);
  const written: Record<string, Doc[]> = {};
  const rowsOf = (name: string) => Object.entries(collections[name] ?? {});
  const matches = (data: Doc, f: Filter) => {
    const v = data[f.field];
    if (f.op === '==') return v === f.value;
    if (f.op === '>=') return millis(v) >= millis(f.value);
    if (f.op === '<') return millis(v) < millis(f.value);
    throw new Error(`未対応の演算子: ${f.op}`);
  };
  const snapOf = (rows: [string, Doc][]) => ({
    docs: rows.map(([id, data]) => ({ id, data: () => data })),
    forEach(cb: (d: { id: string; data: () => Doc }) => void) {
      for (const [id, data] of rows) cb({ id, data: () => data });
    },
  });
  const docRef = (path: string) => {
    const idx = path.lastIndexOf('/');
    const col = path.slice(0, idx);
    const id = path.slice(idx + 1);
    return {
      get: async () => {
        if (failDoc.has(path)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        return { exists: collections[col]?.[id] !== undefined, data: () => collections[col]?.[id] };
      },
      set: async (d: Doc) => { (written[path] ??= []).push(d); },
      delete: async () => { delete collections[col]?.[id]; },
    };
  };
  const queryRef = (name: string, filters: Filter[]) => ({
    where: (field: string, op: string, value: unknown) => queryRef(name, [...filters, { field, op, value }]),
    doc: (id: string) => docRef(`${name}/${id}`),
    get: async () => {
      if (fail.has(name)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      return snapOf(rowsOf(name).filter(([, data]) => filters.every((f) => matches(data, f))));
    },
    add: async (d: Doc) => { (written[name] ??= []).push(d); },
  });
  return { db: { collection: (name: string) => queryRef(name, []), doc: docRef }, written };
}

describe('listUserWorkspaces（通知が見に行くワークスペース）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  it('★招待で参加した店舗（店長）が対象に入る（旧実装は MyDeck だけだった）', async () => {
    const { db } = makeDb({
      shop_shops: { s1: { ownerUid: 'owner1', name: '店A' } },
      'account_users/mgr1/memberships': {
        s1: { shopId: 's1', role: 'manager', status: 'active', shopName: '店A' },
      },
    });
    mocks.db.mockReturnValue(db);

    const ws = await listUserWorkspaces('mgr1');
    expect(ws.map((w) => w.id)).toEqual(['s1', 'mgr1']); // 所属店舗 ＋ MyDeck
    expect(ws[0]).toMatchObject({ name: '店A', type: 'business' });
  });

  it('オーナーは所有クエリと逆引き index の両方に出るが重複しない', async () => {
    const { db } = makeDb({
      shop_shops: { s1: { ownerUid: 'own1', name: '店A' } },
      'account_users/own1/memberships': {
        s1: { shopId: 's1', role: 'owner', status: 'active' },
      },
    });
    mocks.db.mockReturnValue(db);

    expect((await listUserWorkspaces('own1')).map((w) => w.id)).toEqual(['s1', 'own1']);
  });

  it('退店済み（status が active でない）の残骸は対象外', async () => {
    const { db } = makeDb({
      shop_shops: {},
      'account_users/mgr1/memberships': {
        s1: { shopId: 's1', role: 'manager', status: 'left' },
      },
    });
    mocks.db.mockReturnValue(db);

    expect((await listUserWorkspaces('mgr1')).map((w) => w.id)).toEqual(['mgr1']);
  });

  it('キャスト・会計端末の所属は含めない（担当客は MyDeck 側で通知される）', async () => {
    const { db } = makeDb({
      shop_shops: {},
      'account_users/cast1/memberships': {
        s1: { shopId: 's1', role: 'cast', status: 'active' },
        s2: { shopId: 's2', role: 'accounting', status: 'active' },
      },
    });
    mocks.db.mockReturnValue(db);

    expect((await listUserWorkspaces('cast1')).map((w) => w.id)).toEqual(['cast1']);
  });

  it('MyDeck は必ず personal 種別で返す（顧客パスがこの type で決まる）', async () => {
    const { db } = makeDb({ shop_shops: {}, 'account_users/u1/memberships': {} });
    mocks.db.mockReturnValue(db);

    const [myDeck] = await listUserWorkspaces('u1');
    expect(myDeck).toMatchObject({ id: 'u1', type: 'personal' });
    expect(customersCollectionPath(myDeck)).toBe('personal_customers/u1/items');
  });

  it('★逆引きに残った削除済み店舗は対象外（掃除トリガーが届かない既存ゴースト・Day121-PM）', async () => {
    const { db } = makeDb({
      shop_shops: {}, // 店舗 doc はもう無い（members だけが孤児として残っている状態）
      'account_users/mgr1/memberships': {
        ghost: { shopId: 'ghost', role: 'manager', status: 'active', shopName: '閉店した店' },
      },
    });
    mocks.db.mockReturnValue(db);

    expect((await listUserWorkspaces('mgr1')).map((w) => w.id)).toEqual(['mgr1']);
  });

  it('★店舗の生存確認に失敗したら投げる（「無い」に倒して所属を落とさない）', async () => {
    const { db } = makeDb(
      {
        shop_shops: { s1: { ownerUid: 'own1' } },
        'account_users/mgr1/memberships': { s1: { shopId: 's1', role: 'manager', status: 'active' } },
      },
      { failDocs: ['shop_shops/s1'] },
    );
    mocks.db.mockReturnValue(db);

    await expect(listUserWorkspaces('mgr1')).rejects.toThrow();
  });

  it('★逆引き index の読み取り失敗は投げる（黙って「所有店舗だけ」に倒さない）', async () => {
    const { db } = makeDb(
      { shop_shops: { s1: { ownerUid: 'mgr1' } } },
      { failCollections: ['account_users/mgr1/memberships'] },
    );
    mocks.db.mockReturnValue(db);

    await expect(listUserWorkspaces('mgr1')).rejects.toThrow();
  });
});

describe('customersCollectionPath（種別を存在確認から再導出しない・Day121）', () => {
  it('MyDeck は個人台帳、店舗は店舗の顧客', () => {
    expect(customersCollectionPath({ id: 'u1', type: 'personal' })).toBe('personal_customers/u1/items');
    expect(customersCollectionPath({ id: 's1', type: 'business' })).toBe('shop_shops/s1/customers');
  });

  it('★店舗 doc が消えていても店舗として読む（旧実装は uid の id 空間へ落ちていた）', () => {
    // 逆引き index にゴーストが残っている間、旧実装は personal_customers/{shopId}/items を読み、
    // 実際に顧客が残っている shop_shops/{shopId}/customers を素通りしていた
    expect(customersCollectionPath({ id: 'ghost', type: 'business' })).toBe('shop_shops/ghost/customers');
  });

  it('type 未設定は店舗として扱う（個人台帳へ倒さない）', () => {
    expect(customersCollectionPath({ id: 's1' })).toBe('shop_shops/s1/customers');
  });
});

describe('通知ジョブ（店長の立場で実際に届くか）', () => {
  beforeEach(() => { mocks.db.mockReset(); mocks.messaging.mockReset(); });

  /** 店長 mgr1 が店舗 s1 に所属し、s1 に顧客が居るだけの状態 */
  const shopManagerWorld = (
    customers: Record<string, Doc>,
    extra: Record<string, Record<string, Doc>> = {},
  ): Record<string, Record<string, Doc>> => ({
    account_app_settings: { mgr1: { notificationPrefs: { dailySummary: true } } },
    notification_push_tokens: { mgr1: { token: 't1' } },
    shop_shops: { s1: { ownerUid: 'own1', name: '店A' } },
    'account_users/mgr1/memberships': {
      s1: { shopId: 's1', role: 'manager', status: 'active', shopName: '店A' },
    },
    'shop_shops/s1/customers': customers,
    'personal_customers/mgr1/items': {},
    ...extra,
  });

  it('★所属店舗の顧客の誕生日で通知が飛ぶ（旧実装は対象ゼロで永久に無通知）', async () => {
    const todayMd = jstMonthDayDaysAhead(0);
    const { db } = makeDb(shopManagerWorld({ c1: { name: '田中', birthday: `2000-${todayMd}` } }));
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    const result = await runBirthdayReminder();

    expect(result).toMatchObject({ targetCount: 1, notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.title).toContain('田中');
    // どの店の誰かが受け手側で決まらないと通知から開けない（顧客 ID は店舗/MyDeck で別コレクション）
    expect(send.mock.calls[0][0].data).toMatchObject({ customerId: 'c1', workspaceId: 's1' });
  });

  it('所属していない店舗の顧客では飛ばない（対象の広げすぎ防止）', async () => {
    const todayMd = jstMonthDayDaysAhead(0);
    const world = shopManagerWorld({ c1: { name: '田中', birthday: `2000-${todayMd}` } });
    world['account_users/mgr1/memberships'] = {};
    const { db } = makeDb(world);
    mocks.db.mockReturnValue(db);
    mocks.messaging.mockReturnValue({ send: vi.fn() });

    expect(await runBirthdayReminder()).toMatchObject({ notifyCount: 0, sentCount: 0, errorCount: 0 });
  });

  it('★日次サマリが所属店舗の前日売上を集計する（旧実装は毎朝 ¥0 / 0 組）', async () => {
    const yesterday = new Date(jstStartOfYesterday().getTime() + 3 * 60 * 60 * 1000);
    const { db } = makeDb(
      shopManagerWorld(
        { c1: { name: '田中' } },
        {
          'shop_shops/s1/customers/c1/logs': {
            l1: { type: 'visit', datetime: ts(yesterday), salesAmount: 12000 },
          },
        },
      ),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    const result = await runDailySummary();

    expect(result).toMatchObject({ notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.body).toBe('前日: ¥12,000 / 1 組 / 今日の予定: 0 件');
  });

  it('逆引き index が読めない日は uid をエラーとして数える（0 円で送らない）', async () => {
    const { db } = makeDb(shopManagerWorld({ c1: { name: '田中' } }), {
      failCollections: ['account_users/mgr1/memberships'],
    });
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    expect(await runDailySummary()).toMatchObject({ notifyCount: 0, sentCount: 0, errorCount: 1 });
    expect(send).not.toHaveBeenCalled();
  });
});
