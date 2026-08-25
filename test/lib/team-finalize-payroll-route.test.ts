import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/finalize-payroll の POST を Admin SDK モック＋フェイク Firestore で検証する（Day102）。
// 月次給与の確定＝**金銭が確定する唯一の書き込み口**なのにゼロカバレッジだったため characterization する。
// 固定する境界:
//   - 入力検証: shopId 必須 / shopId のパス injection / year・month の範囲（Day102 実バグ修正）
//   - 認可: ownerUid 一致 or members.role が owner/manager（cast/accounting は 403）
//   - 集計: 期間クエリ＋period 前方一致・完了勤務のみ加算・退勤忘れ(staleOpens)は 0 分で行に残す
//   - 金額: 基本給＝丸め済み時間×時給（明細ラベルと検算が一致）・バック/ボーナス/控除
//   - 書込: dryRun は書かない / 確定は payrolls/{castUid}/items/{period} に merge
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
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => '<serverTimestamp>' } };
});

import { Timestamp } from 'firebase-admin/firestore';
import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/team/finalize-payroll/route';

type Doc = Record<string, unknown>;
type Written = { path: string; data: Doc; opts: unknown };

/**
 * doc/collection/where/batch に対応する最小フェイク（full-path キー）。
 * db.doc() は Firestore と同じく**セグメント数が奇数のパスで throw** する
 * （castUid のパス injection がガード無しでは 500 になることを再現するため）。
 */
function makeDb(seed: Record<string, Doc> = {}) {
  const store: Record<string, Doc | undefined> = { ...seed };
  const written: Written[] = [];
  let committed = 0;
  const docRef = (p: string) => {
    if (p.split('/').length % 2 !== 0) throw new Error(`documentPath must point to a document: ${p}`);
    return { path: p, get: async () => ({ exists: store[p] !== undefined, data: () => store[p] }) };
  };
  const collDocs = (cp: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(cp + '/') && !k.slice(cp.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(cp.length + 1), data: () => store[k] as Doc }));
  type Cond = { field: string; op: string; value: string };
  const queryOn = (cp: string, conds: Cond[]) => ({
    where: (field: string, op: string, value: string) => queryOn(cp, [...conds, { field, op, value }]),
    get: async () => ({
      docs: collDocs(cp).filter((d) => conds.every((c) => {
        const v = d.data()[c.field];
        if (typeof v !== 'string') return false; // Firestore の範囲クエリは型が違う/欠損の doc を返さない
        return c.op === '>=' ? v >= c.value : c.op === '<' ? v < c.value : v === c.value;
      })),
    }),
  });
  const db = {
    doc: docRef,
    collection: (cp: string) => queryOn(cp, []),
    batch: () => ({
      set: (ref: { path: string }, data: Doc, opts: unknown) => { written.push({ path: ref.path, data, opts }); },
      commit: async () => { committed += 1; },
    }),
  };
  return { db, store, written, commits: () => committed };
}

const req = (body: unknown) => ({ json: async () => body }) as never;
const ts = (ms: number) => Timestamp.fromMillis(ms);
/** 2026-08-07 20:00 起点（ミリ秒は相対値で十分＝分数だけ効く） */
const T0 = 1_770_000_000_000;
const H = 3_600_000;

const BASE: Record<string, Doc> = {
  'shop_shops/s1': { ownerUid: 'owner1' },
  'shop_shops/s1/members/mgr1': { role: 'manager' },
  'shop_shops/s1/members/cast1': { role: 'cast', castDisplayName: 'あや' },
  'shop_shops/s1/members/acc1': { role: 'accounting' },
  'shop_shops/s1/seating_casts/c1': { uid: 'cast1', name: 'あや', hourlyWage: 3000 },
};
const shift = (id: string, castUid: string, date: string, startMs: number | null, endMs: number | null): [string, Doc] => [
  `shop_shops/s1/shifts/${id}`,
  { castUid, date, ...(startMs != null ? { startAt: ts(startMs) } : {}), ...(endMs != null ? { endAt: ts(endMs) } : {}) },
];
type Row = { castUid: string; name: string; hours: number; wage: number; base: number; total: number; staleOpens: number };
const rowsOf = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()).rows as Row[];

describe('team/finalize-payroll POST（月次給与の確定）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('owner1');
    mocks.getDb.mockReset();
  });

  describe('入力検証と認可', () => {
    it('shopId 未指定は 400', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({}))).status).toBe(400);
    });

    it('認証失敗は 401', async () => {
      mocks.verify.mockRejectedValue(new AuthError('unauthorized'));
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 's1' }))).status).toBe(401);
    });

    it('店舗が存在しなければ 404', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 'nope' }))).status).toBe(404);
    });

    it('cast / accounting は確定できない（403）', async () => {
      for (const uid of ['cast1', 'acc1']) {
        mocks.verify.mockResolvedValue(uid);
        mocks.getDb.mockReturnValue(makeDb(BASE).db);
        expect((await POST(req({ shopId: 's1' }))).status).toBe(403);
      }
    });

    it('manager は確定できる（owner と同じ扱い）', async () => {
      mocks.verify.mockResolvedValue('mgr1');
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true }))).status).toBe(200);
    });

    it('members に doc が無い赤の他人は 403（ownerUid 一致のみが例外）', async () => {
      mocks.verify.mockResolvedValue('stranger');
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      expect((await POST(req({ shopId: 's1' }))).status).toBe(403);
    });
  });

  describe('対象年月の検証（Day102 修正: ゴミ period での確定書き込みを止める）', () => {
    it.each([
      ['month が 13', { year: 2026, month: 13 }],
      ['month が 0', { year: 2026, month: 0 }],
      ['month が小数', { year: 2026, month: 1.5 }],
      ['year が null（UI で月入力を空にすると NaN→null で飛ぶ）', { year: null, month: 8 }],
      ['year が範囲外', { year: 12026, month: 8 }],
    ])('%s は 400（当月へ無言フォールバックしない）', async (_label, part) => {
      const f = makeDb(BASE);
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', ...part }));
      expect(res.status).toBe(400);
      expect(f.written).toHaveLength(0);
    });

    it('数値文字列の year/month はその月として扱う（旧実装は無言で当月に化けていた＝別の月を上書き確定する事故）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-03-04', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', year: '2026', month: '3' }));
      expect((await res.json()).period).toBe('2026-03');
      expect(f.written[0].path).toBe('shop_shops/s1/payrolls/cast1/items/2026-03');
    });

    it('year/month を両方省略した場合はサーバ既定月にフォールバックする（既存互換）', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      const res = await POST(req({ shopId: 's1', dryRun: true }));
      const now = new Date();
      expect((await res.json()).period).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    });

    it('shopId に `/` が入っていたら 400（パス injection・Day102 ハードニング）', async () => {
      const f = makeDb(BASE);
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1/customers/c1', year: 2026, month: 8 }));
      expect(res.status).toBe(400);
      expect(f.written).toHaveLength(0);
    });
  });

  describe('勤務の集計', () => {
    it('完了勤務のみ加算し、対象月の範囲外は数えない', async () => {
      const f = makeDb({
        ...BASE,
        ...Object.fromEntries([
          shift('a', 'cast1', '2026-08-01', T0, T0 + 5 * H),      // 5h
          shift('b', 'cast1', '2026-08-31', T0, T0 + 3 * H),      // 3h
          shift('c', 'cast1', '2026-07-31', T0, T0 + 9 * H),      // 前月（範囲外）
          shift('d', 'cast1', '2026-09-01', T0, T0 + 9 * H),      // 翌月（範囲外）
        ]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ castUid: 'cast1', name: 'あや', hours: 8, wage: 3000, base: 24000, total: 24000, staleOpens: 0 });
    });

    it('12 月は翌年 1 月を上限に取る（nextPeriod の年越し）', async () => {
      const f = makeDb({
        ...BASE,
        ...Object.fromEntries([
          shift('a', 'cast1', '2026-12-31', T0, T0 + 2 * H),
          shift('b', 'cast1', '2027-01-01', T0, T0 + 9 * H),
        ]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 12, dryRun: true })));
      expect(rows[0].hours).toBe(2);
    });

    it('退勤忘れ（endAt 無し）は 0 分だが staleOpens として行に残す＝黙って消さない', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-02', T0, null)]) });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows[0]).toMatchObject({ hours: 0, base: 0, staleOpens: 1 });
    });

    it('end <= start（日跨ぎを同暦日で締めた破損データ）も staleOpens として扱う', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-02', T0, T0 - H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows[0]).toMatchObject({ hours: 0, staleOpens: 1 });
    });

    it('勤務ゼロのキャストは行に出ない', async () => {
      mocks.getDb.mockReturnValue(makeDb(BASE).db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows).toHaveLength(0);
    });

    it('castUid に `/` が混じった壊れた shift があっても 500 にせず、その行だけ捨てる（Day102 ハードニング）', async () => {
      const f = makeDb({
        ...BASE,
        ...Object.fromEntries([
          shift('bad', '../../account_users/x', '2026-08-01', T0, T0 + 5 * H),
          shift('ok', 'cast1', '2026-08-01', T0, T0 + 2 * H),
        ]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', year: 2026, month: 8 }));
      expect(res.status).toBe(200);
      const rows = await rowsOf(res);
      expect(rows.map((r) => r.castUid)).toEqual(['cast1']);
      expect(f.written.map((w) => w.path)).toEqual(['shop_shops/s1/payrolls/cast1/items/2026-08']);
    });

    // P154-PM2: 上の「その行だけ捨てる」は正しいが、**捨てたことを誰にも言っていなかった**。
    // 「castUid が壊れている」（欠陥）と「別の月だった」（正しい絞り込み）が
    // 1 つの guard に畳まれていたため、その人の勤務時間が給与から消えたまま見えなかった。
    it('捨てた行は unattributed として件数で返す（黙って消さない）', async () => {
      const f = makeDb({
        ...BASE,
        ...Object.fromEntries([
          shift('bad1', '../../account_users/x', '2026-08-01', T0, T0 + 5 * H),
          shift('bad2', '', '2026-08-02', T0, T0 + 3 * H),
          shift('other', 'cast1', '2026-07-31', T0, T0 + 9 * H), // 別の月＝正しい絞り込み
          shift('ok', 'cast1', '2026-08-01', T0, T0 + 2 * H),
        ]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', year: 2026, month: 8 }));
      const body = await res.json();
      expect(body.unattributed).toBe(2);            // 壊れた 2 行だけ
      expect(body.rows.map((r: { castUid: string }) => r.castUid)).toEqual(['cast1']);
      expect(body.rows[0].hours).toBe(2);           // 別の月は混ざっていない
    });

    it('壊れた行が無ければ unattributed は 0（欄が無いのと 0 件は別のこと）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('ok', 'cast1', '2026-08-01', T0, T0 + H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const body = await (await POST(req({ shopId: 's1', year: 2026, month: 8 }))).json();
      expect(body.unattributed).toBe(0);
    });

    it('dryRun でも unattributed を返す（確定前に気づけないと意味が無い）', async () => {
      const f = makeDb({
        ...BASE,
        ...Object.fromEntries([shift('bad', 'a/b', '2026-08-01', T0, T0 + H)]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const body = await (await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true }))).json();
      expect(body.dryRun).toBe(true);
      expect(body.unattributed).toBe(1);
      expect(f.written).toEqual([]);
    });
  });

  describe('金額の計算', () => {
    it('基本給は「明細に載る時間 × 時給」と一致する（Day102 修正: 検算できる明細）', async () => {
      // 305.7 分 = 5.095h。旧実装は base をフル精度で計算しつつ hours は 5.1 で返していたため
      // 明細の「5.1h × ¥3,000」を検算すると ¥15,300 なのに amount は ¥15,285 だった。
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 305.7 * 60_000)]) });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', year: 2026, month: 8 }));
      const rows = await rowsOf(res);
      const doc = f.written[0].data as { hours: number; breakdown: { label: string; amount: number }[] };
      expect(rows[0].base).toBe(Math.round(rows[0].hours * rows[0].wage));
      expect(doc.breakdown[0].label).toContain(`勤務 ${doc.hours}h`);
      expect(doc.breakdown[0].amount).toBe(Math.round(doc.hours * 3000));
    });

    it('バック/ボーナス/控除を合算する（控除は符号に関わらず減算・明細は負値）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({
        shopId: 's1', year: 2026, month: 8,
        adjustments: { cast1: { back: 5000, bonus: 1000, penalty: 2000 } },
      }));
      const rows = await rowsOf(res);
      expect(rows[0].total).toBe(6000 + 5000 + 1000 - 2000);
      const bd = (f.written[0].data as { breakdown: { label: string; amount: number }[] }).breakdown;
      expect(bd.map((b) => b.amount)).toEqual([6000, 5000, 1000, -2000]);
    });

    it('控除を負値で渡しても減算になる（符号ゆらぎで増額されない）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true, adjustments: { cast1: { penalty: -2000 } } })));
      expect(rows[0].total).toBe(4000);
    });

    it('数値でない調整値は 0 として扱う（NaN 汚染で総額が壊れない）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({
        shopId: 's1', year: 2026, month: 8, dryRun: true,
        adjustments: { cast1: { back: '5000', bonus: null, penalty: Infinity } },
      })));
      expect(rows[0].total).toBe(6000);
    });

    it('wageOverrides は >0 のときだけ名簿の時給に優先する', async () => {
      const seed = { ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) };
      mocks.getDb.mockReturnValue(makeDb(seed).db);
      const ov = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true, wageOverrides: { cast1: 4000 } })));
      expect(ov[0]).toMatchObject({ wage: 4000, base: 8000 });
      mocks.getDb.mockReturnValue(makeDb(seed).db);
      const zero = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true, wageOverrides: { cast1: 0 } })));
      expect(zero[0]).toMatchObject({ wage: 3000, base: 6000 });
    });

    it('名簿未紐付け（時給0）でも行は出る＝UI で時給を入れて救済できる', async () => {
      const f = makeDb({
        'shop_shops/s1': { ownerUid: 'owner1' },
        'shop_shops/s1/members/lone': { role: 'cast', castDisplayName: 'りん' },
        ...Object.fromEntries([shift('a', 'lone', '2026-08-01', T0, T0 + 2 * H)]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows[0]).toMatchObject({ name: 'りん', wage: 0, base: 0 });
    });

    it('合計の降順で返す', async () => {
      const f = makeDb({
        ...BASE,
        'shop_shops/s1/seating_casts/c2': { uid: 'cast2', name: 'ゆき', hourlyWage: 9000 },
        ...Object.fromEntries([
          shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H),
          shift('b', 'cast2', '2026-08-01', T0, T0 + 2 * H),
        ]),
      });
      mocks.getDb.mockReturnValue(f.db);
      const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
      expect(rows.map((r) => r.castUid)).toEqual(['cast2', 'cast1']);
    });
  });

  describe('名前のフォールバックと書き込み', () => {
    it('名簿に名前が無ければ members.castDisplayName → account_users.displayName → uid 先頭8文字', async () => {
      const base = { 'shop_shops/s1': { ownerUid: 'owner1' } };
      const sh = Object.fromEntries([shift('a', 'abcdefghijkl', '2026-08-01', T0, T0 + H)]);
      const cases: [Record<string, Doc>, string][] = [
        [{ 'shop_shops/s1/members/abcdefghijkl': { castDisplayName: '源氏名' } }, '源氏名'],
        [{ 'account_users/abcdefghijkl': { displayName: 'アカウント名' } }, 'アカウント名'],
        [{}, 'abcdefgh'],
      ];
      for (const [extra, expected] of cases) {
        mocks.getDb.mockReturnValue(makeDb({ ...base, ...sh, ...extra }).db);
        const rows = await rowsOf(await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true })));
        expect(rows[0].name).toBe(expected);
      }
    });

    it('dryRun は1件も書かずコミットもしない（プレビュー）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      const res = await POST(req({ shopId: 's1', year: 2026, month: 8, dryRun: true }));
      expect((await res.json()).dryRun).toBe(true);
      expect(f.written).toHaveLength(0);
      expect(f.commits()).toBe(0);
    });

    it('確定は payrolls/{castUid}/items/{period} へ merge で書く（再確定＝上書き・重複しない）', async () => {
      const f = makeDb({ ...BASE, ...Object.fromEntries([shift('a', 'cast1', '2026-08-01', T0, T0 + 2 * H)]) });
      mocks.getDb.mockReturnValue(f.db);
      await POST(req({ shopId: 's1', year: 2026, month: 8 }));
      expect(f.written).toHaveLength(1);
      expect(f.written[0].path).toBe('shop_shops/s1/payrolls/cast1/items/2026-08');
      expect(f.written[0].opts).toEqual({ merge: true });
      expect(f.written[0].data).toMatchObject({ period: '2026-08', label: '2026年8月', status: '確定', finalizedBy: 'owner1', total: 6000, wage: 3000 });
      expect(f.commits()).toBe(1);
    });
  });
});
