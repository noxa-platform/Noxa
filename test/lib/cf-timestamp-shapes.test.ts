import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cloud Functions が読む時刻値の**形**を固定する（P166）。
//
// ## 由来（P165 の引き継ぎ④「functions/src の生読み 34 件の分類」）
// 34 件を「写像関数へ渡す形」と「生のまま項目を取る形」に分けたところ、
// `functions/src/lib/workspaces.ts` は後者で、しかも**時刻値を 1 つの形だと決め打ち**していた:
//   `lastContactAt: (data.lastContactAt as Timestamp | null) ?? null`
// 読み手はこれに `.toMillis()` を直接呼ぶ（long-time-no-see / next-action / daily-summary）。
//
// 🔴 **その決め打ちが成り立たないことは、このリポが既に実害として記録している。**
// `src/lib/datetime.ts:58` に「nomishugy の移行（P46）で `lastContactAt` を number で書いて
// 顧客一覧だけ『—』になった」とある。Web はそれを受けて `toMillis`（number / Date /
// ISO 文字列 / `{seconds}` を受ける）へ 9 箇所を集約した（P153-PM12）。
// ⚠️ **その集約は `src/` だけを見ていた。** 同じフィールドを読む `functions/src` は素のまま残り、
// 画面と違って「—」では済まない——`.toMillis is not a function` で uid ごと throw する。
//
// ## なぜ「その顧客が出ない」で済まないか
// 例外は uid ループの try/catch が拾うので、**1 件の壊れた doc がその uid の
// 全ワークスペース・全顧客の通知を落とす**（巻き添え）。画面が無いので誰も気付かず、
// 残るのは errorCount のログだけ。＝ ラチェットが「CF は API ルートより上流」と書いた形そのもの。

const mocks = vi.hoisted(() => ({ db: vi.fn(), messaging: vi.fn() }));
vi.mock('../../functions/src/admin', () => ({ db: mocks.db, messaging: mocks.messaging }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__', increment: (n: number) => ({ __increment: n }) },
  Timestamp: { fromDate: (d: Date) => ({ toMillis: () => d.getTime() }) },
}));

import { listCustomers } from '../../functions/src/lib/workspaces';
import { runLongTimeNoSeeReminder } from '../../functions/src/notifications/long-time-no-see';
import { runNextActionReminder } from '../../functions/src/notifications/next-action';
import { runDailySummary } from '../../functions/src/notifications/daily-summary';
import { runBirthdayReminder } from '../../functions/src/notifications/birthday';
import { jstDaysAgo, jstStartOfToday, jstMonthDayDaysAhead } from '../../functions/src/lib/datetime';

type Doc = Record<string, unknown>;
type Filter = { field: string; op: string; value: unknown };

const ts = (d: Date) => ({ toMillis: () => d.getTime() });
const millis = (v: unknown): number =>
  typeof (v as { toMillis?: () => number })?.toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : Number(v);

/**
 * `cf-notification-workspaces.test.ts` と同じ最小フェイク。
 * ⚠️ **範囲クエリの忠実度には限界がある**: ここでは `where('datetime','>=',…)` を
 * `Number(v)` で比較するので number の datetime も一致するが、**実 Firestore は型が違えば
 * 一致しない**（数値と Timestamp は別の型順序）。＝ このフェイクは「書き込み側が number を
 * 書いたときログが集計から静かに落ちる」を**再現できない**。だからここでは
 * クエリの挙動を主張せず、`.toMillis()` を呼ぶ**読み手**の側だけを測る。
 */
function makeDb(collections: Record<string, Record<string, Doc>>) {
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
      get: async () => ({ exists: collections[col]?.[id] !== undefined, data: () => collections[col]?.[id] }),
      set: async () => {},
      delete: async () => {},
    };
  };
  const queryRef = (name: string, filters: Filter[]) => ({
    where: (field: string, op: string, value: unknown) => queryRef(name, [...filters, { field, op, value }]),
    doc: (id: string) => docRef(`${name}/${id}`),
    get: async () => snapOf(rowsOf(name).filter(([, data]) => filters.every((f) => matches(data, f)))),
    add: async () => {},
  });
  return { db: { collection: (name: string) => queryRef(name, []), doc: docRef } };
}

/** MyDeck だけを持つ利用者 u1（通知の最小世界）。顧客は個人台帳に置く */
const soloWorld = (
  pref: 'longTimeNoSee' | 'nextAction' | 'dailySummary' | 'birthday',
  customers: Record<string, Doc>,
  extra: Record<string, Record<string, Doc>> = {},
): Record<string, Record<string, Doc>> => ({
  account_app_settings: { u1: { notificationPrefs: { [pref]: true } } },
  notification_push_tokens: { u1: { token: 't1' } },
  shop_shops: {},
  'account_users/u1/memberships': {},
  'personal_customers/u1/items': customers,
  ...extra,
});

const daysAgoMs = (n: number) => jstDaysAgo(n).getTime() + 60 * 60 * 1000;

describe('listCustomers が受ける時刻値の形（Web の toMillis と同じ幅）', () => {
  beforeEach(() => { mocks.db.mockReset(); });

  /**
   * ⚠️ **読み手を緩くしても壊れるものは無いが、逆は通知を消す**（`src/lib/datetime.ts` の判断と同じ）。
   * ここで受ける形を狭めると、いま number で保存されているデータの通知が一斉に止まる。
   */
  it('Timestamp / number / ISO 文字列 / {seconds} を同じミリ秒に揃える', async () => {
    const at = new Date('2026-08-26T03:00:00.000Z');
    const { db } = makeDb({
      'personal_customers/u1/items': {
        c1: { name: 'A', lastContactAt: ts(at) },
        c2: { name: 'B', lastContactAt: at.getTime() },
        c3: { name: 'C', lastContactAt: at.toISOString() },
        c4: { name: 'D', lastContactAt: { seconds: Math.floor(at.getTime() / 1000) } },
      },
    });
    mocks.db.mockReturnValue(db);

    const cs = await listCustomers({ id: 'u1', type: 'personal' });
    expect(cs.map((c) => c.lastContactAt)).toEqual([at.getTime(), at.getTime(), at.getTime(), at.getTime()]);
  });

  /**
   * ⚠️ **読めない形は null**（0 に倒すと 1970-01-01 という意味のある時刻に化け、
   * 「30 日以上連絡なし」に永久に該当し続ける）。`src/lib/datetime.ts` と同じ既定。
   */
  it('読めない形（真偽値・空オブジェクト・数字だけの文字列）は null にする', async () => {
    const { db } = makeDb({
      'personal_customers/u1/items': {
        c1: { name: 'A', lastContactAt: true },
        c2: { name: 'B', lastContactAt: {} },
        c3: { name: 'C', lastContactAt: '7' },
        c4: { name: 'D' },
      },
    });
    mocks.db.mockReturnValue(db);

    const cs = await listCustomers({ id: 'u1', type: 'personal' });
    expect(cs.map((c) => c.lastContactAt)).toEqual([null, null, null, null]);
  });

  it('totalSales / birthday も型が違えば既定へ倒す（文字列の金額を数値として通さない）', async () => {
    const { db } = makeDb({
      'personal_customers/u1/items': {
        c1: { name: 'A', totalSales: '12000', birthday: 20000101 },
      },
    });
    mocks.db.mockReturnValue(db);

    const [c] = await listCustomers({ id: 'u1', type: 'personal' });
    // 文字列のまま通すと `salesTotal += c.totalSales` が文字列連結になり「¥012000」が出る
    expect(c.totalSales).toBe(0);
    expect(c.birthday).toBeNull();
  });
});

describe('壊れた形の 1 件が uid ごと通知を落とさない（巻き添えの遮断）', () => {
  beforeEach(() => { mocks.db.mockReset(); mocks.messaging.mockReset(); });

  it('★ご無沙汰: number で書かれた lastContactAt でも該当を拾う（旧実装は throw）', async () => {
    const { db } = makeDb(
      soloWorld('longTimeNoSee', {
        c1: { name: '田中', lastContactAt: daysAgoMs(60), totalSales: 50000 },
      }),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    const result = await runLongTimeNoSeeReminder();

    expect(result).toMatchObject({ notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.title).toContain('1 名');
  });

  it('★ご無沙汰: 読めない 1 件が、正常な他の顧客の通知を巻き添えにしない', async () => {
    const { db } = makeDb(
      soloWorld('longTimeNoSee', {
        broken: { name: '壊れ', lastContactAt: true, totalSales: 50000 },
        c1: { name: '田中', lastContactAt: ts(new Date(daysAgoMs(60))), totalSales: 50000 },
      }),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    const result = await runLongTimeNoSeeReminder();

    // 壊れた 1 件は対象外、正常な 1 件は届く（旧実装は errorCount 1・送信ゼロ）
    expect(result).toMatchObject({ notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.title).toContain('1 名');
  });

  it('★次回アクション: number の nextActionDue でも期限到来を数える', async () => {
    const { db } = makeDb(
      soloWorld('nextAction', {
        c1: { name: '田中', nextAction: '連絡する', nextActionDue: jstStartOfToday().getTime() },
      }),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    expect(await runNextActionReminder()).toMatchObject({ notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.title).toContain('1 件');
  });

  /**
   * 🔴 日次サマリは**無条件送信**なので、ここで throw すると
   * 「前日売上は正しく集計できているのに、その通知ごと消える」。
   * ＝ 0 円が出るのではなく**何も来ない**日が生まれる。
   */
  it('★日次サマリ: 予定日の形が壊れていても前日売上の通知は届く', async () => {
    const yesterday = new Date(jstDaysAgo(1).getTime() + 3 * 60 * 60 * 1000);
    const { db } = makeDb(
      soloWorld(
        'dailySummary',
        { c1: { name: '田中', nextActionDue: true } },
        {
          'personal_customers/u1/items/c1/logs': {
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

  /**
   * ⚠️ 売上の**文字列**は throw しない代わりに金額を化けさせる（`0 + "12000"` → `"012000"`）。
   * 落ちない誤りなので、落ちる誤りより見つかりにくい。
   */
  it('★日次サマリ: 文字列の salesAmount を混ぜても金額が文字列連結にならない', async () => {
    const yesterday = new Date(jstDaysAgo(1).getTime() + 3 * 60 * 60 * 1000);
    const { db } = makeDb(
      soloWorld(
        'dailySummary',
        { c1: { name: '田中' } },
        {
          'personal_customers/u1/items/c1/logs': {
            l1: { type: 'visit', datetime: ts(yesterday), salesAmount: 12000 },
            l2: { type: 'visit', datetime: ts(yesterday), salesAmount: '8000' },
          },
        },
      ),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    await runDailySummary();

    // 読めない金額は 0（勝手に 8000 と解釈して足さない）。組数は 2 組のまま
    expect(send.mock.calls[0][0].notification.body).toBe('前日: ¥12,000 / 2 組 / 今日の予定: 0 件');
  });

  it('★誕生日: 数値で保存された birthday は静かに落とすが、他の顧客は通知する', async () => {
    const todayMd = jstMonthDayDaysAhead(0);
    const { db } = makeDb(
      soloWorld('birthday', {
        broken: { name: '壊れ', birthday: 20000101 },
        c1: { name: '田中', birthday: `2000-${todayMd}` },
      }),
    );
    mocks.db.mockReturnValue(db);
    const send = vi.fn().mockResolvedValue('ok');
    mocks.messaging.mockReturnValue({ send });

    const result = await runBirthdayReminder();

    expect(result).toMatchObject({ notifyCount: 1, sentCount: 1, errorCount: 0 });
    expect(send.mock.calls[0][0].notification.title).toContain('田中');
  });
});
