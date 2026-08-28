import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stripComments } from '../helpers/strip-comments';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  type Cond = { field: string; op: string; value: unknown };
  const match = (d: Doc, conds: Cond[]) => conds.every((c) => {
    const v = d[c.field] as { toMillis?: () => number } | undefined;
    // 等価条件（出所の絞り込み・P128）。時刻でないフィールドも扱えるようにする
    if (c.op === '==') return d[c.field] === c.value;
    if (!v || typeof v.toMillis !== 'function') return false;
    const bound = (c.value as { toMillis(): number }).toMillis();
    return c.op === '>=' ? v.toMillis() >= bound : v.toMillis() < bound;
  });
  const inColl = (cp: string) => entries().filter(([k]) => k.startsWith(cp + '/') && !k.slice(cp.length + 1).includes('/'));
  const queryOn = (cp: string, conds: Cond[]) => ({
    where: (field: string, op: string, value: Cond['value']) => queryOn(cp, [...conds, { field, op, value }]),
    // count() にも条件を効かせる（当店由来だけを数えるようになったため・P128）
    count: () => ({ get: async () => ({ data: () => ({ count: inColl(cp).filter(([, d]) => match(d, conds)).length }) }) }),
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

  // Day103: 「不正な year/month を黙って当月に落とす」を廃止（Day102 の給与確定と同型）。
  // 読み取り専用ルートなので事故は書き潰しではなく「違う月の数字を頼んだ月として表示する」だが、
  // 気づけない分だけ質が悪い（キャストの成績＝評価・給与の根拠になる数字）。
  describe('対象月の受け取り（Day103・finalize-payroll と同契約）', () => {
    it('数値文字列の year/month は「頼んだ月」として解釈する（当月へ落とさない）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      const res = await POST(req({ shopId: 's1', year: '2026', month: '3' }));
      expect(res.status).toBe(200);
      expect((await res.json()).period).toEqual({ year: 2026, month: 3 }); // 旧実装は当月が返っていた
    });

    it('数値にならない/範囲外/小数/null は 400（黙って当月に落とさない）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 's1', year: 2026, month: 13 }))).status).toBe(400);
      expect((await POST(req({ shopId: 's1', year: 2026, month: 0 }))).status).toBe(400);
      expect((await POST(req({ shopId: 's1', year: 2026, month: 1.5 }))).status).toBe(400);
      expect((await POST(req({ shopId: 's1', year: 2026, month: 'さん' }))).status).toBe(400);
      expect((await POST(req({ shopId: 's1', year: null, month: 3 }))).status).toBe(400);
    });

    it('未指定（undefined）だけはサーバ当月へフォールバック＝既存互換', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      const res = await POST(req({ shopId: 's1' }));
      expect(res.status).toBe(200);
      const now = new Date();
      expect((await res.json()).period).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
    });

    it('集計した対象月を period として返す（頼んだ月と突き合わせられる）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      const res = await POST(req(body));
      expect((await res.json()).period).toEqual({ year: 2026, month: 8 });
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
    // ログ・日売には出所（shopId）が入る。CF の投影が最初から刻んでいる値で、
    // これが当店と一致するものだけを成績に数える（P128）
    const logs = {
      // personal_customers/{castUid}/items/{cid}/logs/{lid}
      'personal_customers/cast1/items/c1/logs/l1': { shopId: 's1', salesAmount: 10000, type: 'visit', datetime: ts('2026-08-03T21:00') },
      'personal_customers/cast1/items/c1/logs/l2': { shopId: 's1', salesAmount: 5000, type: 'outside', datetime: ts('2026-08-03T23:00') },
      'personal_customers/cast1/items/c1/logs/l3': { shopId: 's1', salesAmount: 0, type: 'line', datetime: ts('2026-08-04T12:00') },
      'personal_customers/cast2/items/c9/logs/l1': { shopId: 's1', salesAmount: 30000, type: 'visit', datetime: ts('2026-08-05T20:00') },
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
        'personal_customers/cast1/items/c1/logs/old': { shopId: 's1', salesAmount: 99999, type: 'visit', datetime: ts('2026-07-31T20:00') },
        'personal_customers/cast1/items/c1/logs/new': { shopId: 's1', salesAmount: 1000, type: 'visit', datetime: ts('2026-08-10T20:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')?.monthSales).toBe(1000);
    });

    it('personal_customers 配下でない logs（他モデル）と対象外キャストの logs は混ぜない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'shop_shops/s1/customers/c1/logs/l1': { shopId: 's1', salesAmount: 777777, type: 'visit', datetime: ts('2026-08-03T21:00') },
        'personal_customers/acc1/items/c1/logs/l1': { shopId: 's1', salesAmount: 555555, type: 'visit', datetime: ts('2026-08-03T21:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.every((x) => x.monthSales === 0)).toBe(true);
    });

    it('顧客なし日売（personal_sales）を合算し、groupCount 未設定は 1 組として数える', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_sales/cast1/items/s1': { shopId: 's1', salesAmount: 8000, datetime: ts('2026-08-06T22:00') },
        'personal_sales/cast1/items/s2': { shopId: 's1', salesAmount: 2000, groupCount: 3, datetime: ts('2026-08-06T23:00') },
        'personal_sales/cast1/items/old': { shopId: 's1', salesAmount: 99999, datetime: ts('2026-07-01T22:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')).toMatchObject({ monthSales: 10000, monthGroupCount: 4 });
    });

    it('顧客数は personal_customers/{castUid}/items のうち当店から渡した分（count 集計）', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1': { name: 'A', assignedFromShopId: 's1' },
        'personal_customers/cast1/items/c2': { name: 'B', assignedFromShopId: 's1' },
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

  // 掛け持ち（増店）でデータが追従するか（P128）。
  // 個人台帳は「そのキャストの全部」であって「当店の分」ではない。旧実装は castUid が
  // 当店のメンバーかしか見ておらず、他店の売上と本人の副業が当店の成績・日次内訳・
  // 担当顧客数に加算されていた（給与査定と評価の材料）。
  describe('出所（どの店の記録か）で当店分に絞る', () => {
    it('★他店の来店ログは当店の売上・組数に入らない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/mine': { shopId: 's1', salesAmount: 10000, type: 'visit', datetime: ts('2026-08-03T21:00') },
        'personal_customers/cast1/items/c2/logs/other': { shopId: 's2', salesAmount: 90000, type: 'visit', datetime: ts('2026-08-03T22:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')).toMatchObject({ monthSales: 10000, monthGroupCount: 1 });
    });

    it('★出所の無い来店ログ（店を経由していない個人の記録）も当店に入れない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/personal': { salesAmount: 50000, type: 'visit', datetime: ts('2026-08-03T21:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')?.monthSales).toBe(0);
    });

    it('★個人ワークスペースの手入力売上（shopId なし）と他店の控えを日売に足さない', async () => {
      // SalesClient は個人モードで shopId を書かずに personal_sales へ直接 addDoc する。
      // 本人の副業の数字が店の成績表に載っていた
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_sales/cast1/items/mine': { shopId: 's1', salesAmount: 8000, datetime: ts('2026-08-06T22:00') },
        'personal_sales/cast1/items/other': { shopId: 's2', salesAmount: 70000, datetime: ts('2026-08-06T22:30') },
        'personal_sales/cast1/items/private': { salesAmount: 60000, datetime: ts('2026-08-06T23:00') },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')).toMatchObject({ monthSales: 8000, monthGroupCount: 1 });
    });

    it('★担当顧客数は当店から渡した分だけ（他店の客・本人が個人で登録した客を数えない）', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1': { name: 'A', assignedFromShopId: 's1' },
        'personal_customers/cast1/items/c2': { name: 'B', assignedFromShopId: 's2' },
        'personal_customers/cast1/items/c3': { name: 'C' },
      }).db);
      const m = await membersOf(await POST(req(body)));
      expect(m.find((x) => x.uid === 'cast1')?.customerCount).toBe(1);
    });

    it('★日次内訳（全キャスト合算）にも他店・個人の分が乗らない', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/mine': { shopId: 's1', salesAmount: 10000, type: 'visit', datetime: ts('2026-08-05T21:00') },
        'personal_customers/cast2/items/c9/logs/other': { shopId: 's2', salesAmount: 20000, type: 'visit', datetime: ts('2026-08-05T22:00') },
        'personal_sales/cast1/items/private': { salesAmount: 5000, datetime: ts('2026-08-05T23:00') },
      }).db);
      expect(await dailyOf(await POST(req(body)))).toEqual([
        { dateKey: '2026-08-05', amount: 10000, count: 1 },
      ]);
    });

    it('★範囲外は incomplete（読めなかった）に混ぜない — 集計範囲は scopeNote で伝える', async () => {
      // 「読めなかったので数字が少ない」と「定義として範囲外」は受け手の取るべき行動が違う
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/other': { shopId: 's2', salesAmount: 90000, type: 'visit', datetime: ts('2026-08-03T21:00') },
      }).db);
      const json = await (await POST(req(body))).json();
      expect(json.incomplete).toBeUndefined();
      expect(typeof json.scopeNote).toBe('string');
      expect(json.scopeNote).toMatch(/当店/);
    });
  });

  describe('dailyTotals（日次内訳）', () => {
    it('JST 暦日キーで全キャスト合算し、dateKey 昇順で返す', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/l1': { shopId: 's1', salesAmount: 10000, type: 'visit', datetime: ts('2026-08-05T21:00') },
        'personal_customers/cast2/items/c9/logs/l1': { shopId: 's1', salesAmount: 20000, type: 'visit', datetime: ts('2026-08-05T22:00') },
        'personal_customers/cast1/items/c1/logs/l2': { shopId: 's1', salesAmount: 3000, type: 'line', datetime: ts('2026-08-03T13:00') },
        'personal_sales/cast1/items/s1': { shopId: 's1', salesAmount: 5000, groupCount: 2, datetime: ts('2026-08-05T23:00') },
      }).db);
      expect(await dailyOf(await POST(req(body)))).toEqual([
        { dateKey: '2026-08-03', amount: 3000, count: 0 },   // line は組数に数えない
        { dateKey: '2026-08-05', amount: 35000, count: 4 },  // visit×2 + 日売 groupCount2
      ]);
    });

    it('深夜（JST 0〜9時）のログは JST 暦日で当日側に入る（UTC 前日にならない）', async () => {
      mocks.getDb.mockReturnValue(makeDb({
        ...BASE,
        'personal_customers/cast1/items/c1/logs/l1': { shopId: 's1', salesAmount: 4000, type: 'visit', datetime: ts('2026-08-08T02:30') },
      }).db);
      expect((await dailyOf(await POST(req(body))))[0].dateKey).toBe('2026-08-08');
    });

    it('売上ゼロなら dailyTotals は空配列', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect(await dailyOf(await POST(req(body)))).toEqual([]);
    });
  });

  // 部分的に読めなかったときに **0 を実績として返さない**（Day116）。
  // 旧実装は来店ログ・個人売上・顧客数の失敗をすべて null/0 に倒したうえで 200 を返しており、
  // 画面は「今月の売上0・顧客0」と表示していた（本物の 0 と区別が付かない＝評価と給与を誤らせる）。
  describe('部分的な読み取り失敗（Day116）', () => {
    /** `.where()` を何回繋いでも最後の get() が失敗するクエリ（実際の呼び出しは where×2） */
    const failingQuery = (reason: string): { where: () => unknown; get: () => Promise<never>; count: () => { get: () => Promise<never> } } => {
      const q = {
        where: () => q,
        get: async () => { throw new Error(reason); },
        count: () => ({ get: async () => { throw new Error(reason); } }),
      };
      return q;
    };

    it('来店ログが読めなければ incomplete に載る（成功応答のまま黙らない）', async () => {
      const { db } = makeDb(BASE);
      db.collectionGroup = (() => failingQuery('index missing')) as unknown as typeof db.collectionGroup;
      mocks.getDb.mockReturnValue(db);
      const res = await POST(req(body));
      expect(res.status).toBe(200);
      expect((await res.json()).incomplete).toContain('来店ログ');
    });

    it('個人売上が読めなければ incomplete に載る', async () => {
      const { db } = makeDb(BASE);
      const orig = db.collection;
      db.collection = ((cp: string) => (cp.startsWith('personal_sales/')
        ? failingQuery('unavailable')
        : orig(cp))) as unknown as typeof db.collection;
      mocks.getDb.mockReturnValue(db);
      expect((await (await POST(req(body))).json()).incomplete).toContain('個人売上');
    });

    it('顧客数の集計が失敗すれば incomplete に載る（customerCount 0 と区別する）', async () => {
      const { db } = makeDb(BASE);
      const orig = db.collection;
      db.collection = ((cp: string) => {
        const q = orig(cp);
        if (!cp.startsWith('personal_customers/')) return q;
        // where() を挟んでも壊れた count() が残るようにする（出所で絞るようになったため・P128）
        const broken: { where: () => unknown; count: () => { get: () => Promise<never> }; get: typeof q.get } = {
          where: () => broken,
          count: () => ({ get: async () => { throw new Error('count failed'); } }),
          get: q.get,
        };
        return broken;
      }) as unknown as typeof db.collection;
      mocks.getDb.mockReturnValue(db);
      const json = await (await POST(req(body))).json();
      expect(json.incomplete).toContain('顧客数');
      expect((json.members as Member[]).every((m) => m.customerCount === 0)).toBe(true); // 0 だが「実績なし」ではない
    });

    it('すべて読めていれば incomplete は付かない（常時警告にしない）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await (await POST(req(body))).json()).incomplete).toBeUndefined();
    });
  });
});

// サーバが `incomplete` を返しても、画面が読まなければ利用者にとっては無音のまま（Day116-PM）。
// 受け手側の契約もここで固定する。
describe('成績画面が incomplete を受け取って警告する（Day116-PM）', () => {
  const src = stripComments(readFileSync(resolve(__dirname, '../../src/components/modules/customers/CustomersClient.tsx'), 'utf8'));

  it('応答の incomplete を読み、専用の警告 state へ入れる', () => {
    expect(src).toMatch(/incomplete\?: string\[\]/);   // 型に載っている
    expect(src).toMatch(/setWarn\(data\.incomplete/);   // 警告として表示する
  });

  // Day116-PM2: 同じ画面の「担当顧客」展開は、取得失敗を空配列にして
  // 「担当顧客はまだいません。」と表示していた（担当0人と区別が付かない）。
  it('担当顧客の展開も、取得失敗を「担当なし」と同じ表示にしない', () => {
    expect(src).toMatch(/setSelErr\(/);
    expect(src).toMatch(/selErr \? <span role="alert"/);
    // 失敗時に空配列を入れない（null のままにして「まだいません」を出させない）
    expect(src).not.toMatch(/catch \{ setSelCustomers\(\[\]\); \}/);
  });

  it('警告は致命的エラー（err）と混ぜない', () => {
    // 同じ state に入れると ①一覧が出ているのにエラー表示になる
    // ②「キャストがいません」の空案内（!err 条件）が消える
    expect(src).toMatch(/\{warn && </);
    expect(src).not.toMatch(/setErr\(data\.incomplete/);
  });
});
