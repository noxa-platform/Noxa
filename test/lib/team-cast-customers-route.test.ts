import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/cast-customers の POST を Admin SDK モック＋フェイク Firestore で検証する（Day82）。
// owner/manager が特定キャストの担当客台帳（personal_customers/{castUid}/items）を俯瞰する読み取り。
// 固定する境界:
//   - 入力必須（shopId/castUid）・shop 不在=404
//   - 認可: 呼び出し元が owner/manager のみ（else 403）
//   - castUid が当該 shop のメンバー（or owner 本人）であること（else 403）
//   - マッピング: name フォールバック・colorTag/rank の null 既定・lastContactAt(Timestamp→ISO)・totalSales 降順
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
    toDate() { return new Date(this._ms); }
    static fromMillis(ms: number) { return new Timestamp(ms); }
  }
  return { Timestamp };
});

import { Timestamp } from 'firebase-admin/firestore';
import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/team/cast-customers/route';

/** doc.get()＋collection().get() 対応の最小フェイク（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const collDocs = (cp: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(cp + '/') && !k.slice(cp.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(cp.length + 1), data: () => store[k] }));
  const db = {
    doc: (p: string) => ({ get: async () => snap(p) }),
    collection: (cp: string) => ({ get: async () => ({ docs: collDocs(cp) }) }),
  };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
const SHOP = {
  'shop_shops/s1': { ownerUid: 'owner1' },
  'shop_shops/s1/members/mgr1': { role: 'manager' },
  'shop_shops/s1/members/cast1': { role: 'cast' },
};
type Cust = { id: string; name: string; colorTag: string | null; rank: string | null; lastContactAt: string | null; totalSales: number };
const custs = async (r: Awaited<ReturnType<typeof POST>>) => (await r.json()).customers as Cust[];

describe('team/cast-customers POST（担当客台帳の俯瞰・認可境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('owner1');
    mocks.getDb.mockReset();
  });

  it('入力欠落は 400 / shop 不在は 404', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ shopId: 's1' }))).status).toBe(400);
    expect((await POST(req({ shopId: 'nope', castUid: 'cast1' }))).status).toBe(404);
  });

  it('非 owner/manager 呼び出しは 403', async () => {
    mocks.verify.mockResolvedValue('cast1');
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', castUid: 'cast1' }))).status).toBe(403);
  });

  it('castUid が shop メンバーでなければ 403', async () => {
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', castUid: 'ghost' }))).status).toBe(403);
  });

  it('owner 呼び出し: マッピングと totalSales 降順ソート', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      ...SHOP,
      'personal_customers/cast1/items/c1': { assignedFromShopId: 's1', name: 'アオイ', colorTag: 'red', rank: 'A', totalSales: 100, lastContactAt: Timestamp.fromMillis(0) },
      'personal_customers/cast1/items/c2': { assignedFromShopId: 's1', totalSales: 300 }, // name/colorTag/rank/lastContact 無し
    }).db);
    const list = await custs(await POST(req({ shopId: 's1', castUid: 'cast1' })));
    expect(list.map((c) => c.id)).toEqual(['c2', 'c1']); // 売上降順
    const c1 = list.find((c) => c.id === 'c1')!;
    expect(c1.name).toBe('アオイ');
    expect(c1.colorTag).toBe('red');
    expect(c1.rank).toBe('A');
    expect(c1.lastContactAt).toBe('1970-01-01T00:00:00.000Z'); // Timestamp→ISO
    const c2 = list.find((c) => c.id === 'c2')!;
    expect(c2.name).toBe('—');             // 名前フォールバック
    expect(c2.colorTag).toBeNull();
    expect(c2.rank).toBeNull();
    expect(c2.lastContactAt).toBeNull();   // Timestamp でない→null
    expect(c2.totalSales).toBe(300);
  });

  // 台帳はキャスト個人のもので、掛け持ち先で作られた客も本人が個人で登録した客も同じ場所に入る。
  // 旧実装は全件を返しており、オーナーが**他店の顧客名簿（氏名・累計売上・最終接触日）を
  // 閲覧できる**状態だった。これは数字のズレではなく漏洩なので絞り込みは必須（P128）。
  it('★当店から渡した客だけを返す（他店の客・本人が個人で登録した客を出さない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      ...SHOP,
      'personal_customers/cast1/items/mine': { assignedFromShopId: 's1', name: '当店の客', totalSales: 100 },
      'personal_customers/cast1/items/other': { assignedFromShopId: 's2', name: '他店の客', totalSales: 900 },
      'personal_customers/cast1/items/private': { name: '本人の客', totalSales: 800 },
    }).db);
    const list = await custs(await POST(req({ shopId: 's1', castUid: 'cast1' })));
    expect(list.map((c) => c.id)).toEqual(['mine']);
    expect(JSON.stringify(list)).not.toContain('他店の客');
    expect(JSON.stringify(list)).not.toContain('本人の客');
  });

  it('★集計範囲を scopeNote で返す（除外件数は返さない＝掛け持ち先の露見にしない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      ...SHOP,
      'personal_customers/cast1/items/other': { assignedFromShopId: 's2', name: '他店の客', totalSales: 900 },
    }).db);
    const json = await (await POST(req({ shopId: 's1', castUid: 'cast1' }))).json();
    expect(json.customers).toEqual([]);
    expect(typeof json.scopeNote).toBe('string');
    // 「他店の台帳が N 件あります」は掛け持ちの露見。件数の類は返さない
    expect(Object.keys(json).sort()).toEqual(['customers', 'scopeNote']);
  });

  it('manager 呼び出しも許可 / owner 本人を castUid にできる', async () => {
    mocks.verify.mockResolvedValue('mgr1');
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', castUid: 'cast1' }))).status).toBe(200);

    mocks.verify.mockResolvedValue('owner1');
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', castUid: 'owner1' }))).status).toBe(200); // ownerUid===castUid
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    mocks.getDb.mockReturnValue(makeDb(SHOP).db);
    expect((await POST(req({ shopId: 's1', castUid: 'cast1' }))).status).toBe(401);
  });
});
