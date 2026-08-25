import { describe, it, expect, beforeEach, vi } from 'vitest';

// 記録エンジン段 7 の永続化（P152）。`/api/record-engine/apply` と `/revert`。
//
// 固定する挙動:
//   - **必ずトランザクション**でスキーマと控えを一緒に書く
//   - **現行スキーマはサーバで読み直す**（クライアントの姿を土台にしない）
//   - `revert` は **token 一致を要求**する（owner が複数いる店で他人の適用を消さない）
//   - 引かなかったものは理由付きで返す

const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn(), getDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/access-context', () => ({ resolveAccessContext: mocks.resolve }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__' },
}));

import { POST as APPLY } from '../../src/app/api/record-engine/apply/route';
import { POST as REVERT } from '../../src/app/api/record-engine/revert/route';

const SCHEMA_PATH = 'shop_shops/w1/settings/record_schema';
const RECEIPT_PATH = 'shop_shops/w1/settings/record_schema_receipt';

function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const snap = (p: string) => ({ exists: store[p] !== undefined, data: () => store[p] });
  const ref = (p: string) => ({ path: p });
  let committed = false;
  const db = {
    doc: (p: string) => ref(p),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      const pending: (() => void)[] = [];
      const r = await fn({
        get: async (x: { path: string }) => snap(x.path),
        set: (x: { path: string }, d: Record<string, unknown>) => pending.push(() => { store[x.path] = d; }),
        delete: (x: { path: string }) => pending.push(() => { delete store[x.path]; }),
      });
      // トランザクションらしく、**最後にまとめて**適用する
      for (const p of pending) p();
      committed = pending.length > 0;
      return r;
    },
  };
  return { db, store, wrote: () => committed };
}

const req = (body: unknown) => ({ json: async () => body }) as never;

const PACK = {
  fields: [
    { key: 'bottle_count', type: 'count', label: 'ボトル本数', roles: ['bottle'], reason: 'シャンパン推し' },
    { key: 'unit_price', type: 'money', label: '単価', roles: [], reason: '売上を出すため' },
  ],
  derivations: [{
    key: 'bottle_sales', label: 'ボトル売上',
    expr: { op: '*', args: [{ field: 'unit_price' }, { field: 'bottle_count' }] },
    reason: '自動計算',
  }],
};

describe('record-engine/apply', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'owner' });
    mocks.getDb.mockReset();
  });

  it('workspaceId 欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await APPLY(req({ pack: PACK }))).status).toBe(400);
  });

  it('店舗の member は 403（オーナー限定）', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'member' });
    const { db, wrote } = makeDb();
    mocks.getDb.mockReturnValue(db);
    expect((await APPLY(req({ workspaceId: 'w1', pack: PACK }))).status).toBe(403);
    expect(wrote()).toBe(false);
  });

  // 押した人は何かが起きたと思う。成功として返さない
  it('選択が空配列なら 400（何も選ばずに適用を成功にしない）', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await APPLY(req({ workspaceId: 'w1', pack: PACK, selectedKeys: [] }))).status).toBe(400);
  });

  it('適用するとスキーマと控えが一緒に書かれ、token を返す', async () => {
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const r = await APPLY(req({ workspaceId: 'w1', pack: PACK }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.token).toMatch(/^rp_/);
    expect(j.applied.fields).toEqual(['bottle_count', 'unit_price']);
    expect(j.applied.derivations).toEqual(['bottle_sales']);
    // 両方書かれている（片方だけ、が起きない）
    expect(store[SCHEMA_PATH]).toBeDefined();
    expect(store[RECEIPT_PATH]).toBeDefined();
    expect((store[RECEIPT_PATH] as { token: string }).token).toBe(j.token);
  });

  it('選ばれたものだけ適用する', async () => {
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const j = await (await APPLY(req({ workspaceId: 'w1', pack: PACK, selectedKeys: ['bottle_count'] }))).json();
    expect(j.applied.fields).toEqual(['bottle_count']);
    expect((store[SCHEMA_PATH] as { fields: { key: string }[] }).fields.map((f) => f.key)).toEqual(['bottle_count']);
  });

  // クライアントが古い姿を持っていても、他人の変更を巻き戻さない
  it('現行スキーマはサーバで読み直す（既存項目を消さない）', async () => {
    const { db, store } = makeDb({
      [SCHEMA_PATH]: { fields: [{ key: 'someone_else', type: 'count', label: '他人が足した', roles: [] }] },
    });
    mocks.getDb.mockReturnValue(db);
    await APPLY(req({ workspaceId: 'w1', pack: PACK }));
    const keys = (store[SCHEMA_PATH] as { fields: { key: string }[] }).fields.map((f) => f.key);
    expect(keys).toContain('someone_else');
    expect(keys).toContain('bottle_count');
  });

  // 生成 API を経由せず直接叩かれても、壊れた式は入らない
  it('壊れた式のパックは 409（適用できるものが無い）', async () => {
    const { db, wrote } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const r = await APPLY(req({
      workspaceId: 'w1',
      pack: { derivations: [{ key: 'bad', label: 'B', expr: { op: '**', args: [{ lit: 1 }, { lit: 2 }] }, reason: 'x' }] },
    }));
    expect(r.status).toBe(409);
    expect((await r.json()).rejected[0].reason).toContain('式が不正です');
    expect(wrote()).toBe(false);
  });

  it('全部が既存と重複したら 409（控えを空で保存しない）', async () => {
    const { db, store } = makeDb({
      [SCHEMA_PATH]: {
        fields: [
          { key: 'bottle_count', type: 'count', label: 'x', roles: [] },
          { key: 'unit_price', type: 'money', label: 'y', roles: [] },
        ],
        derivations: [{ key: 'bottle_sales', label: 'z', expr: { lit: 1 } }],
      },
    });
    mocks.getDb.mockReturnValue(db);
    expect((await APPLY(req({ workspaceId: 'w1', pack: PACK }))).status).toBe(409);
    expect(store[RECEIPT_PATH]).toBeUndefined();
  });
});

describe('record-engine/revert', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.resolve.mockReset().mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'owner' });
    mocks.getDb.mockReset();
  });

  /** 適用済みの状態を作る */
  async function applied() {
    const { db, store } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const j = await (await APPLY(req({ workspaceId: 'w1', pack: PACK }))).json();
    return { db, store, token: j.token as string };
  }

  it('token 欠落は 400', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    expect((await REVERT(req({ workspaceId: 'w1' }))).status).toBe(400);
  });

  it('控えが無ければ 409', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    const r = await REVERT(req({ workspaceId: 'w1', token: 'rp_x' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('取り消せる変更がありません');
  });

  // owner が複数いる店で、A が押して B の適用が消えるのを防ぐ
  it('token が一致しなければ拒否する（他人の適用を消さない）', async () => {
    const { db, store } = await applied();
    mocks.getDb.mockReturnValue(db);
    const r = await REVERT(req({ workspaceId: 'w1', token: 'rp_someone_else' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('別の変更が適用されている');
    // 何も消えていない
    expect((store[SCHEMA_PATH] as { fields: unknown[] }).fields).toHaveLength(2);
    expect(store[RECEIPT_PATH]).toBeDefined();
  });

  it('token が一致すれば足した分だけ引き、控えを消す', async () => {
    const { db, store, token } = await applied();
    mocks.getDb.mockReturnValue(db);
    const j = await (await REVERT(req({ workspaceId: 'w1', token }))).json();
    expect(j.removed.sort()).toEqual(['bottle_count', 'bottle_sales', 'unit_price']);
    expect((store[SCHEMA_PATH] as { fields: unknown[] }).fields).toEqual([]);
    expect(store[RECEIPT_PATH]).toBeUndefined(); // 二度押しで「既に削除されていました」が並ばない
  });

  it('AI が足していない項目は残す', async () => {
    const { db, store, token } = await applied();
    const cur = store[SCHEMA_PATH] as { fields: unknown[]; derivations: unknown[] };
    store[SCHEMA_PATH] = {
      ...cur,
      fields: [...cur.fields, { key: 'my_field', type: 'count', label: '自分で足した', roles: [] }],
    };
    mocks.getDb.mockReturnValue(db);
    const j = await (await REVERT(req({ workspaceId: 'w1', token }))).json();
    expect(j.schema.fields.map((f: { key: string }) => f.key)).toEqual(['my_field']);
  });

  it('適用後に編集された項目は引かず、理由を返す', async () => {
    const { db, store, token } = await applied();
    const cur = store[SCHEMA_PATH] as { fields: { key: string; label: string }[]; derivations: unknown[] };
    store[SCHEMA_PATH] = {
      ...cur,
      fields: cur.fields.map((f) => (f.key === 'bottle_count' ? { ...f, label: '本数（改）' } : f)),
    };
    mocks.getDb.mockReturnValue(db);
    const j = await (await REVERT(req({ workspaceId: 'w1', token }))).json();
    expect(j.schema.fields.map((f: { key: string }) => f.key)).toEqual(['bottle_count']);
    expect(j.skipped.some((s: { reason: string }) => s.reason.includes('編集されている'))).toBe(true);
  });

  it('member は 403', async () => {
    const { db, token } = await applied();
    mocks.resolve.mockResolvedValue({ kind: 'shop', shopId: 'w1', uid: 'u1', role: 'member' });
    mocks.getDb.mockReturnValue(db);
    expect((await REVERT(req({ workspaceId: 'w1', token }))).status).toBe(403);
  });
});
