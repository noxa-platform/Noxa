import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/redeem-invite の POST を Admin SDK モック＋クエリ対応フェイク Firestore で検証する（Day72）。
// 店舗メンバー招待の受諾は「招待検証 → members 登録 → seating_casts 紐付け」を単一 tx で原子化する。
// 特に cast 紐付け（uid 済 > 同名未紐付け > 新規）は「給与¥0＝seating_casts.uid 断線」の入口側の
// 解消機構であり、以下の不変条件をルート単体で固定する:
//   - 使用済み(409)/期限切れ(410)/既メンバー(409)/招待なし(404)は登録しない
//   - cast: uid 紐付け済み名簿があれば触らない・同名未紐付けがあれば uid をセット・無ければ新規作成
//   - cast 以外の role は名簿紐付けをしない

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__' },
  Timestamp: class {}, // expiresAt は number で渡すため toMs の number 経路のみ使う
}));

import { POST } from '../../src/app/api/team/redeem-invite/route';

/** doc（path→data）と collection（colPath→{docId→data}）を持つクエリ対応フェイク Firestore。 */
function makeDb(
  docs: Record<string, Record<string, unknown>> = {},
  cols: Record<string, Record<string, Record<string, unknown>>> = {},
) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...docs };
  const colStore: Record<string, Record<string, Record<string, unknown>>> = JSON.parse(JSON.stringify(cols));
  let autoId = 0;
  const docSnap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const applyDoc = (p: string, d: Record<string, unknown>, merge: boolean) => {
    const i = p.lastIndexOf('/');
    const colP = p.slice(0, i);
    const id = p.slice(i + 1);
    if (colStore[colP]) colStore[colP][id] = merge ? { ...(colStore[colP][id] ?? {}), ...d } : { ...d };
    store[p] = merge ? { ...(store[p] ?? {}), ...d } : { ...d };
  };
  const makeQuery = (colP: string, filters: [string, unknown][] = [], lim = Infinity): Record<string, unknown> => ({
    where: (f: string, _op: string, v: unknown) => makeQuery(colP, [...filters, [f, v]], lim),
    limit: (n: number) => makeQuery(colP, filters, n),
    __run: () => {
      const all = colStore[colP] ?? {};
      const entries = Object.entries(all)
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .slice(0, lim);
      return {
        empty: entries.length === 0,
        size: entries.length,
        docs: entries.map(([id, d]) => ({ id, ref: { path: `${colP}/${id}` }, data: () => d })),
      };
    },
  });
  const collection = (colP: string) => ({
    where: (f: string, op: string, v: unknown) => (makeQuery(colP).where as (a: string, b: string, c: unknown) => unknown)(f, op, v),
    limit: (n: number) => (makeQuery(colP).limit as (n: number) => unknown)(n),
    doc: () => {
      const id = `auto${autoId++}`;
      if (!colStore[colP]) colStore[colP] = {};
      return { path: `${colP}/${id}` };
    },
  });
  const db = {
    doc: (p: string) => ({ path: p, get: async () => docSnap(p) }),
    collection,
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        get: async (r: { __run?: () => unknown; path?: string }) => (r.__run ? r.__run() : docSnap(r.path!)),
        set: (r: { path: string }, d: Record<string, unknown>, opts?: { merge?: boolean }) => applyDoc(r.path, d, !!opts?.merge),
      }),
  };
  return { db, store, colStore };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const FUTURE = Date.now() + 1_000_000_000;
const PAST = Date.now() - 1_000_000;
const SHOP = { 'shop_shops/s1': { name: 'Bar' } };
const CASTS = 'shop_shops/s1/seating_casts';
const castList = (colStore: Record<string, Record<string, Record<string, unknown>>>) =>
  Object.values(colStore[CASTS] ?? {}).map((d) => ({ name: d.name, uid: d.uid }));

describe('team/redeem-invite POST（招待受諾＋cast 名簿紐付け）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
  });

  it('shopId / code 欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ code: 'C1' }))).status).toBe(400);
    expect((await POST(req({ shopId: 's1' }))).status).toBe(400);
  });

  it('店舗が無ければ 404', async () => {
    mocks.getDb.mockReturnValue(makeDb({}).db);
    expect((await POST(req({ shopId: 's1', code: 'C1' }))).status).toBe(404);
  });

  it('招待コードなし 404 / 使用済み 409 / 期限切れ 410', async () => {
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', code: 'C1' }))).status).toBe(404);

    mocks.getDb.mockReturnValue(makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', usedBy: 'x', expiresAt: FUTURE } }).db);
    expect((await POST(req({ shopId: 's1', code: 'C1' }))).status).toBe(409);

    mocks.getDb.mockReturnValue(makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: PAST } }).db);
    expect((await POST(req({ shopId: 's1', code: 'C1' }))).status).toBe(410);
  });

  // ⚠️ **期限が読めない招待は「無期限」ではなく「期限切れ」**（fail-closed・P153-PM13）。
  // 共通の `toMillis` は分からない値に null を返すので、**受け側が `?? 0` に倒すかどうか**で
  // 意味が真逆になる。`?? Infinity` にすると壊れた expiresAt の招待が永久に使える穴になる。
  it('expiresAt が欠損・壊れていても 410（無期限にしない）', async () => {
    for (const broken of [undefined, null, 'あとで', {}, NaN]) {
      mocks.getDb.mockReturnValue(
        makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: broken } }).db,
      );
      expect((await POST(req({ shopId: 's1', code: 'C1' }))).status).toBe(410);
    }
  });

  it('既にメンバーなら 409（招待は消費しない）', async () => {
    const { db, store } = makeDb({
      ...SHOP,
      'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE },
      'shop_shops/s1/members/u1': { role: 'cast' },
    });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req({ shopId: 's1', code: 'C1' }));
    expect(r.status).toBe(409);
    expect((store['shop_shops/s1/invites/C1'] as { usedBy?: string }).usedBy).toBeUndefined();
  });

  it('cast・名簿なし: 新規 cast を uid 付きで作成し member 登録・招待を used 化', async () => {
    const { db, store, colStore } = makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', createdBy: 'owner', expiresAt: FUTURE } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1', displayName: 'あや' }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, role: 'cast', shopId: 's1', shopName: 'Bar' });
    expect(castList(colStore)).toEqual([{ name: 'あや', uid: 'u1' }]); // 新規作成
    expect((store['shop_shops/s1/members/u1'] as { status?: string }).status).toBe('active');
    expect((store['shop_shops/s1/invites/C1'] as { usedBy?: string }).usedBy).toBe('u1');
  });

  it('🔗cast・同名未紐付けの名簿があれば uid をセット（新規作成しない＝給与¥0 断線の解消）', async () => {
    const { db, colStore } = makeDb(
      { ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE } },
      { [CASTS]: { c9: { name: 'あや', uid: null, hourlyWage: 5000 } } },
    );
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1', displayName: 'あや' }));
    expect(r.status).toBe(200);
    // 既存 c9 に uid が入るだけ（新規 cast は増えない・時給等の既存データを温存）
    expect(Object.keys(colStore[CASTS])).toEqual(['c9']);
    expect(colStore[CASTS].c9).toMatchObject({ name: 'あや', uid: 'u1', hourlyWage: 5000 });
  });

  it('cast・既に uid 紐付け済みの名簿があれば触らない（member 登録のみ）', async () => {
    const { db, colStore } = makeDb(
      { ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE } },
      { [CASTS]: { c9: { name: 'ちがう名前', uid: 'u1' } } },
    );
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1', displayName: 'あや' }));
    expect(r.status).toBe(200);
    expect(Object.keys(colStore[CASTS])).toEqual(['c9']); // 変化なし
    expect(colStore[CASTS].c9).toEqual({ name: 'ちがう名前', uid: 'u1' });
  });

  it('cast 以外の role（accounting）は名簿紐付けをしない', async () => {
    const { db, store, colStore } = makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'accounting', expiresAt: FUTURE } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1', displayName: 'けい' }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.role).toBe('accounting');
    expect(colStore[CASTS]).toBeUndefined(); // cast 名簿は触らない
    expect((store['shop_shops/s1/members/u1'] as { role?: string }).role).toBe('accounting');
  });

  // 表示名フォールバック: name = displayName || account_users.displayName || '新メンバー'。
  // この name が cast の作成名・byName 紐付けキー・member.castDisplayName に一貫して使われる。
  it('displayName 省略時は account_users の displayName を採用（cast 名・紐付けキーに反映）', async () => {
    const { db, store, colStore } = makeDb({
      ...SHOP,
      'shop_shops/s1/invites/C1': { role: 'cast', createdBy: 'owner', expiresAt: FUTURE },
      'account_users/u1': { displayName: 'あや' },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1' })); // displayName 未指定
    expect(r.status).toBe(200);
    expect(castList(colStore)).toEqual([{ name: 'あや', uid: 'u1' }]);
    expect((store['shop_shops/s1/members/u1'] as { castDisplayName?: string }).castDisplayName).toBe('あや');
  });

  it('displayName も account 名も無ければ「新メンバー」で作成', async () => {
    const { db, colStore } = makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE } });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1' }));
    expect(r.status).toBe(200);
    expect(castList(colStore)).toEqual([{ name: '新メンバー', uid: 'u1' }]);
  });

  it('フォールバック名でも同名未紐付けの cast に紐付く（account 名で既存名簿へ uid セット）', async () => {
    const { db, colStore } = makeDb(
      { ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE }, 'account_users/u1': { displayName: 'ゆい' } },
      { [CASTS]: { c9: { name: 'ゆい', uid: null } } },
    );
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req({ shopId: 's1', code: 'C1' })); // displayName 省略→account 名 'ゆい' で照合
    expect(r.status).toBe(200);
    expect(Object.keys(colStore[CASTS])).toEqual(['c9']); // 新規作成せず既存に紐付け
    expect(colStore[CASTS].c9).toMatchObject({ name: 'ゆい', uid: 'u1' });
  });

  it('member.invitedBy に招待の createdBy を監査記録（無ければ null）', async () => {
    // createdBy あり
    const withCreator = makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', createdBy: 'owner', expiresAt: FUTURE } });
    mocks.getDb.mockReturnValue(withCreator.db);
    await POST(req({ shopId: 's1', code: 'C1', displayName: 'x' }));
    expect((withCreator.store['shop_shops/s1/members/u1'] as { invitedBy?: string | null }).invitedBy).toBe('owner');

    // createdBy 無し → null
    const noCreator = makeDb({ ...SHOP, 'shop_shops/s1/invites/C1': { role: 'cast', expiresAt: FUTURE } });
    mocks.getDb.mockReturnValue(noCreator.db);
    await POST(req({ shopId: 's1', code: 'C1', displayName: 'x' }));
    expect((noCreator.store['shop_shops/s1/members/u1'] as { invitedBy?: string | null }).invitedBy).toBeNull();
  });
});
