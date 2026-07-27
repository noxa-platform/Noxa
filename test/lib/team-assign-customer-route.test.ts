import { describe, it, expect, beforeEach, vi } from 'vitest';

// team/assign-customer の POST を Admin SDK モック＋フェイク Firestore で検証する（Day81）。
// 未担当客（shop_shops/{shopId}/customers）をキャストの担当台帳（personal_customers/{castUid}/items）へ
// 移動する不可逆操作。以下の境界を固定する:
//   - 入力必須（shopId/customerId/castUid）・shop 不在=404・顧客不在=404
//   - 認可: 呼び出し元が owner/manager のみ（それ以外=403）
//   - 割り当て先: 当該 shop の cast 系メンバー（cast/host/staff/owner/manager）or owner 本人のみ（else=403）
//   - コピー先へ本体＋サブコレクション(logs/gifts)を doc ID 保持で移し、元を削除（copy→delete 順）
//   - 割り当てフィールド（mainCastUid/assignedFromShopId/assignedBy）を付与
//   - 認証失敗=401

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__' },
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/team/assign-customer/route';

/** doc get/set/delete・collection get/doc・batch set/delete 対応の最小フェイク Firestore。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const del = (p: string) => { delete store[p]; };
  const docRef = (p: string): { path: string; get: () => Promise<{ exists: boolean; ref: unknown; data: () => Record<string, unknown> | undefined }>; set: (d: Record<string, unknown>, o?: { merge?: boolean }) => Promise<void>; delete: () => Promise<void>; collection: (sub: string) => unknown } => ({
    path: p,
    get: async () => ({ exists: store[p] !== undefined, ref: docRef(p), data: () => store[p] }),
    set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => { store[p] = o?.merge ? { ...(store[p] ?? {}), ...d } : { ...d }; },
    delete: async () => del(p),
    collection: (sub: string) => collRef(`${p}/${sub}`),
  });
  const collDocs = (collPath: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(collPath + '/') && !k.slice(collPath.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(collPath.length + 1), ref: docRef(k), data: () => store[k] }));
  const collRef = (collPath: string) => ({
    path: collPath,
    doc: (id: string) => docRef(`${collPath}/${id}`),
    get: async () => ({ docs: collDocs(collPath) }),
  });
  const db = {
    doc: (p: string) => docRef(p),
    batch: () => {
      const ops: Array<['set' | 'del', string, Record<string, unknown>?]> = [];
      return {
        set: (r: { path: string }, d: Record<string, unknown>) => ops.push(['set', r.path, d]),
        delete: (r: { path: string }) => ops.push(['del', r.path]),
        commit: async () => { for (const [op, p, d] of ops) { if (op === 'set') store[p] = { ...(d as Record<string, unknown>) }; else del(p); } },
      };
    },
  };
  return { db, store };
}
const req = (body: unknown) => ({ json: async () => body }) as never;
// owner1 が owner・mgr1 が manager・cast1 が cast の shop s1
const SHOP = {
  'shop_shops/s1': { ownerUid: 'owner1' },
  'shop_shops/s1/members/mgr1': { role: 'manager' },
  'shop_shops/s1/members/cast1': { role: 'cast' },
};
const CUSTOMER = { 'shop_shops/s1/customers/c1': { name: 'アオイ', note: 'メモ' } };
const body = (over: Record<string, unknown> = {}) => ({ shopId: 's1', customerId: 'c1', castUid: 'cast1', ...over });

describe('team/assign-customer POST（未担当客の担当割り当て境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('owner1');
    mocks.getDb.mockReset();
  });

  it('入力欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req({ shopId: 's1', customerId: 'c1' }))).status).toBe(400); // castUid 欠落
    expect((await POST(req({}))).status).toBe(400);
  });

  it('shop 不在は 404', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await POST(req(body({ shopId: 'nope' })))).status).toBe(404);
  });

  it('owner 呼び出し: 本体＋サブコレクションを移動し元を削除・割り当てフィールド付与', async () => {
    const { db, store } = makeDb({
      ...SHOP, ...CUSTOMER,
      'shop_shops/s1/customers/c1/logs/l1': { text: '来店' },
      'shop_shops/s1/customers/c1/gifts/g1': { item: 'ボトル' },
    });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req(body()));
    expect(await r.json()).toEqual({ ok: true });

    // コピー先: 本体＋割り当てフィールド＋元データ
    const dest = store['personal_customers/cast1/items/c1'] as Record<string, unknown>;
    expect(dest).toBeDefined();
    expect(dest.mainCastUid).toBe('cast1');
    expect(dest.assignedFromShopId).toBe('s1');
    expect(dest.assignedBy).toBe('owner1');
    expect(dest.name).toBe('アオイ'); // 元データ温存
    // サブコレクションも doc ID 保持で移動
    expect(store['personal_customers/cast1/items/c1/logs/l1']).toBeDefined();
    expect(store['personal_customers/cast1/items/c1/gifts/g1']).toBeDefined();
    // 元は削除（本体＋サブ）
    expect(store['shop_shops/s1/customers/c1']).toBeUndefined();
    expect(store['shop_shops/s1/customers/c1/logs/l1']).toBeUndefined();
    expect(store['shop_shops/s1/customers/c1/gifts/g1']).toBeUndefined();
  });

  it('manager 呼び出しも許可', async () => {
    mocks.verify.mockResolvedValue('mgr1');
    const { db, store } = makeDb({ ...SHOP, ...CUSTOMER });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body()))).status).toBe(200);
    expect(store['personal_customers/cast1/items/c1']).toBeDefined();
  });

  it('cast（非 owner/manager）呼び出しは 403（移動しない）', async () => {
    mocks.verify.mockResolvedValue('cast1');
    const { db, store } = makeDb({ ...SHOP, ...CUSTOMER });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body()))).status).toBe(403);
    expect(store['shop_shops/s1/customers/c1']).toBeDefined(); // 不変
  });

  it('割り当て先が shop メンバーでなければ 403', async () => {
    const { db } = makeDb({ ...SHOP, ...CUSTOMER });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body({ castUid: 'ghost' })))).status).toBe(403);
  });

  it('割り当て先が cast 系でないロール（accounting 等）は 403', async () => {
    const { db } = makeDb({ ...SHOP, ...CUSTOMER, 'shop_shops/s1/members/acc1': { role: 'accounting' } });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body({ castUid: 'acc1' })))).status).toBe(403);
  });

  it('owner 本人を割り当て先にできる（接客運用）', async () => {
    const { db, store } = makeDb({ ...SHOP, ...CUSTOMER });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body({ castUid: 'owner1' })))).status).toBe(200);
    expect(store['personal_customers/owner1/items/c1']).toBeDefined();
  });

  it('対象顧客が不在なら 404', async () => {
    const { db } = makeDb({ ...SHOP });
    mocks.getDb.mockReturnValue(db);
    expect((await POST(req(body({ customerId: 'missing' })))).status).toBe(404);
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    mocks.getDb.mockReturnValue(makeDb({ ...SHOP, ...CUSTOMER }).db);
    expect((await POST(req(body()))).status).toBe(401);
  });
});
