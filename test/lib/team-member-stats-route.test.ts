import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/member-stats の POST を Admin SDK モック＋フェイク Firestore で検証する（Day102）。
// owner/manager が全キャストの当月成績を俯瞰するルート。Admin SDK で各キャストの
// personal 台帳（rules 上は本人しか読めない）を読むため、認可とスコープが命綱。
// 固定する境界:
//   - 入力検証: shopId 必須 / パス injection
//   - 認可: ownerUid 一致 or members.role が owner/manager（cast は 403）
//   - 集計対象: cast/host/staff ロールのみ（owner/accounting の個人台帳を混ぜない）
//   - 売上: 顧客ログ(collectionGroup) + 顧客なし日売(personal_sales) の合算
//   - 組数: countsAsGroup（visit || outside）準拠 / 日売は groupCount（未設定は1）
//   - パス外の logs（他モデル）と対象外キャストの logs を混ぜない
//   - dailyTotals は JST 暦日キーで昇順・全キャスト合算
//   - 認証失敗=401

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => {
  class Timestamp {
    _ms: number;
    constructor(ms: number) { this._ms = ms; }
    toMillis() { return this._ms; }
    static fromMillis(ms: number) { return new Timestamp(ms); }
    static fromDate(d: Date) { return new Timestamp(d.getTime()); }
  }
  return { Timestamp };
});

import { Timestamp } from 'firebase-admin/firestore';
import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/team/member-stats/route';

type Doc = Record<string, unknown>;
type Member = { uid: string; name: string; role: string; customerCount: number; monthSales: number; monthGroupCount: number };
type Daily = { dateKey: string; amount: number; count: number };

/** doc / collection(+where,count) / collectionGroup に対応する最小フェイク（full-path キー） */
function makeDb(seed: Record<string, Doc> = {}) {
  const store: Record<string, Doc | undefined> = { ...seed };
  const entries = () => Object.entries(store) as [string, Doc][];
  type Cond = { field: string; op: string; value: { toMillis(): number } };
  const match = (d: Doc, conds: Cond[]) => conds.every((c) => {
    const v = d[c.field] as { toMillis?: () => number } | undefined;
    if (!v || typeof v.toMillis !== 'function') return false;
    return c.op === '>=' ? v.toMillis() >= c.value.toMillis() : v.toMillis() < c.value.toMillis();
  });
  const inColl = (cp: string) => entries().filter(([k]) => k.startsWith(cp + '/') && !k.slice(cp.length + 1).includes('/'));
  const queryOn = (cp: string, conds: Cond[]) => ({
    where: (field: string, op: string, value: Cond['value']) => queryOn(cp, [...conds, { field, op, value }]),
    count: () => ({ get: async () => ({ data: () => ({ count: inColl(cp).length }) }) }),
    get: async () => ({ docs: inColl(cp).filter(([, d]) => match(d, conds)).map(([k, d]) => ({ id: k.slice(cp.length + 1), ref: { path: k }, data: () => d })) }),
  });
  const groupOn = (name: string, conds: Cond[]) => ({
    where: (field: string, op: string, value: Cond['value']) => groupOn(name, [...conds, { field, op, value }]),
    get: async () => ({
      docs: entries()
        .filter(([k]) => k.split('/').slice(0, -1).pop() === name)
        .filter(([, d]) => match(d, conds))
        .map(([k, d]) => ({ ref: { path: k }, data: () => d })),
    }),
  });
  const db = {
    doc: (p: string) => ({ get: async () => ({ exists: store[p] !== undefined, data: () => store[p] }) }),
    collection: (cp: string) => queryOn(cp, []),
    collectionGroup: (name: string) => groupOn(name, []),
  };
  return { db, store };
}

const req = (body: unknown) => ({ json: async () => body }) as never;
/** JST の壁時計から UTC ミリ秒を作る（jstDateKey の期待値を書きやすくする） */
const jst = (s: string) => new Date(`${s}+09:00`).getTime();
const ts = (s: string) => Timestamp.fromMillis(jst(s));

const BASE: Record<string, Doc> = {
  'shop_shops/s1': { ownerUid: 'owner1' },
  'shop_shops/s1/members/owner1': { role: 'owner' },
  'shop_shops/s1/members/mgr1': { role: 'manager' },
  'shop_shops/s1/members/cast1': { role: 'cast', castDisplayName: 'あや' },
  'shop_shops/s1/members/cast2': { role: 'host', castName: 'れん' },
  'shop_shops/s1/members/acc1': { role: 'accounting' },
};
const body = { shopId: 's1', year: 2026, month: 8 };
const membersOf = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()).members as Member[];
const dailyOf = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()).dailyTotals as Daily[];

describe('team/member-stats POST（キャスト別 当月成績）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('owner1');
    mocks.getDb.mockReset();
  });

  describe('入力検証と認可', () => {
    it('shopId 未指定は 400', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({}))).status).toBe(400);
    });

    it('shopId に `/` が入っていたら 400（パス injection・Day102 ハードニング）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 's1/members/cast1' }))).status).toBe(400);
    });

    it('認証失敗は 401', async () => {
      mocks.verify.mockRejectedValue(new AuthError('unauthorized'));
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req(body))).status).toBe(401);
    });

    it('店舗が存在しなければ 404', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ ...body, shopId: 'nope' }))).status).toBe(404);
    });

    it('cast は他人の成績を覗けない（403）', async () => {
      mocks.verify.mockResolvedValue('cast1');
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req(body))).status).toBe(403);
    });

    it('manager は閲覧できる', async () => {
      mocks.verify.mockResolvedValue('mgr1');
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req(body))).status).toBe(200);
    });

    it('メンバーでもない他人は 403', async () => {
      mocks.verify.mockResolvedValue('stranger');
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req(body))).status).toBe(403);
    });
  });

  describe('集計対象の絞り込み', () => {
    it('cast/host/staff のみ集計し、owner/accounting は含めない（個人副業データの混入防止）', async () => {
      mocks.getDb.mockReturnValue(makeDb({ ...BASE, 'shop_shops/s1/members/st1': { role: 'staff' } }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.map((x) => x.uid).sort()).toEqual(['cast1', 'cast2', 'st1']);
    });

    it('role 未設定のメンバーは cast 扱いで集計に入る', async () => {
      mocks.getDb.mockReturnValue(makeDb({ 'shop_shops/s1': { ownerUid: 'owner1' }, 'shop_shops/s1/members/x1': { castDisplayName: 'のん' } }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m).toEqual([{ uid: 'x1', name: 'のん', role: 'cast', customerCount: 0, monthSales: 0, monthGroupCount: 0 }]);
    });

    it('表示名は members.castDisplayName → castName → account_users.displayName → uid 先頭8文字', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        'shop_shops/s1': { ownerUid: 'owner1' },
        'shop_shops/s1/members/aaaaaaaaaaaa': { role: 'cast' },
        'shop_shops/s1/members/bbbbbbbbbbbb': { role: 'cast' },
        'account_users/aaaaaaaaaaaa': { displayName: 'アカウント名' },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(Object.fromEntries(m.map((x) => [x.uid, x.name]))).toEqual({ aaaaaaaaaaaa: 'アカウント名', bbbbbbbbbbbb: 'bbbbbbbb' });
    });
  });

  describe('売上・組数の集計', () => {
    const logs = {
      // personal_customers/{castUid}/items/{cid}/logs/{lid}
      'personal_customers/cast1/items/c1/logs/l1': { salesAmount: 10000, type: 'visit', datetime: ts('2026-08-03T21:00') },
      'personal_customers/cast1/items/c1/logs/l2': { salesAmount: 5000, type: 'outside', datetime: ts('2026-08-03T23:00') },
      'personal_customers/cast1/items/c1/logs/l3': { salesAmount: 0, type: 'line', datetime: ts('2026-08-04T12:00') },
      'personal_customers/cast2/items/c9/logs/l1': { salesAmount: 30000, type: 'visit', datetime: ts('2026-08-05T20:00') },
    };

    it('顧客ログを castUid 別に合算し、組数は visit/outside のみ数える', async () => {
      mocks.getDb.mockReturnValue(makeDb({ ...BASE, ...logs }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')).toMatchObject({ monthSales: 15000, monthGroupCount: 2 });
      expect(m.find((x) => x.uid === 'cast2')).toMatchObject({ monthSales: 30000, monthGroupCount: 1 });
    });

    it('対象月の外のログは含めない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/old': { salesAmount: 99999, type: 'visit', datetime: ts('2026-07-31T20:00') },
        'personal_customers/cast1/items/c1/logs/new': { salesAmount: 1000, type: 'visit', datetime: ts('2026-08-10T20:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')?.monthSales).toBe(1000);
    });

    it('personal_customers 配下でない logs（他モデル）と対象外キャストの logs は混ぜない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'shop_shops/s1/customers/c1/logs/l1': { salesAmount: 777777, type: 'visit', datetime: ts('2026-08-03T21:00') },
        'personal_customers/acc1/items/c1/logs/l1': { salesAmount: 555555, type: 'visit', datetime: ts('2026-08-03T21:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.every((x) => x.monthSales === 0)).toBe(true);
    });

    it('顧客なし日売（personal_sales）を合算し、groupCount 未設定は 1 組として数える', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_sales/cast1/items/s1': { salesAmount: 8000, datetime: ts('2026-08-06T22:00') },
        'personal_sales/cast1/items/s2': { salesAmount: 2000, groupCount: 3, datetime: ts('2026-08-06T23:00') },
        'personal_sales/cast1/items/old': { salesAmount: 99999, datetime: ts('2026-07-01T22:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')).toMatchObject({ monthSales: 10000, monthGroupCount: 4 });
    });

    it('顧客数は personal_customers/{castUid}/items の件数（count 集計）', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1': { name: 'A' },
        'personal_customers/cast1/items/c2': { name: 'B' },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')?.customerCount).toBe(2);
      expect(m.find((x) => x.uid === 'cast2')?.customerCount).toBe(0);
    });

    it('売上の降順で返す', async () => {
      mocks.getDb.mockReturnValue(makeDb({ ...BASE, ...logs }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.map((x) => x.uid)).toEqual(['cast2', 'cast1', 'acc1'].filter((u) => u !== 'acc1'));
    });
  });

  describe('dailyTotals（日次内訳）', () => {
    it('JST 暦日キーで全キャスト合算し、dateKey 昇順で返す', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/l1': { salesAmount: 10000, type: 'visit', datetime: ts('2026-08-05T21:00') },
        'personal_customers/cast2/items/c9/logs/l1': { salesAmount: 20000, type: 'visit', datetime: ts('2026-08-05T22:00') },
        'personal_customers/cast1/items/c1/logs/l2': { salesAmount: 3000, type: 'line', datetime: ts('2026-08-03T13:00') },
        'personal_sales/cast1/items/s1': { salesAmount: 5000, groupCount: 2, datetime: ts('2026-08-05T23:00') },
      }).db);
      expect(await dailyOf(await POST(req(body)))).toEqual([
        { dateKey: '2026-08-03', amount: 3000, count: 0 },   // line は組数に数えない
        { dateKey: '2026-08-05', amount: 35000, count: 4 },  // visit×2 + 日売 groupCount2
      ]);
    });

    it('深夜（JST 0〜9時）のログは JST 暦日で当日側に入る（UTC 前日にならない）', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/l1': { salesAmount: 4000, type: 'visit', datetime: ts('2026-08-08T02:30') },
      }).db);
      expect((await dailyOf(await POST(req(body))))[0].dateKey).toBe('2026-08-08');
    });

    it('売上ゼロなら dailyTotals は空配列', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect(await dailyOf(await POST(req(body)))).toEqual([]);
    });
  });
});
