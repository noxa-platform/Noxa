import { describe, it, expect, beforeEach, vi } from 'vitest';

// account/delete の POST を Admin SDK モック＋フェイク Firestore で検証する（Day80）。
// 退会は破壊的かつ PII/課金の後始末を伴うため、以下の不変条件をルート単体で固定する:
//   - token の uid のみを削除（body に uid を取らない＝IDOR 無し・他ユーザーの doc は不変）
//   - handle は account_users 削除前に読み、profile_pages/{handle} を削除（handle 無しは触らない）
//   - 主要 doc（account_users/subscriptions/google_tokens/push_tokens）＋ai_usage サブコレクション削除
//   - personal_reminders は ownerUid==uid のみ削除（他人の reminder は残す）
//   - personal_* の個人データツリーを根から再帰削除（Day82。items/standalone/messages まで）
//   - ワークスペース: member doc は削除、owner なら WS doc も削除・非 owner は WS を残す
//   - Auth の deleteUser(uid) を呼ぶ / 認証失敗は 401

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), getAuth: vi.fn(), deleteUser: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  getAdminAuth: mocks.getAuth,
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { POST } from '../../src/app/api/account/delete/route';

/** doc get/delete・collection get/where・batch delete 対応の最小フェイク Firestore（full-path キー）。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const del = (p: string) => { delete store[p]; };
  const ref = (p: string) => ({ path: p, delete: async () => del(p) });
  const snap = (p: string) => ({ exists: store[p] !== undefined, ref: ref(p), data: () => store[p] });
  // collPath 直下の doc（セグメントがちょうど1つ多い）を列挙
  const collDocs = (collPath: string) =>
    Object.keys(store)
      .filter((k) => k.startsWith(collPath + '/') && !k.slice(collPath.length + 1).includes('/'))
      .map((k) => ({ id: k.slice(collPath.length + 1), ref: ref(k), data: () => store[k] }));
  const makeColl = (collPath: string) => ({
    get: async () => ({ docs: collDocs(collPath) }),
    where: (field: string, _op: string, val: unknown) => ({
      get: async () => ({ docs: collDocs(collPath).filter((d) => store[d.ref.path]?.[field] === val) }),
    }),
  });
  const db = {
    doc: (p: string) => ({ path: p, get: async () => snap(p), delete: async () => del(p) }),
    collection: (p: string) => makeColl(p),
    // Admin SDK の recursiveDelete 相当。doc 自身とその配下（サブコレクション含む）を消す。
    // フェイクは full-path キーなので「path/ で始まるキー」を落とせば等価になる。
    recursiveDelete: async (r: { path: string }) => {
      del(r.path);
      Object.keys(store).filter((k) => k.startsWith(r.path + '/')).forEach(del);
    },
    batch: () => {
      const ops: string[] = [];
      return { delete: (r: { path: string }) => ops.push(r.path), commit: async () => ops.forEach(del) };
    },
  };
  return { db, store };
}
const req = () => ({}) as never;

describe('account/delete POST（退会の破壊的後始末の境界）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('u1');
    mocks.getDb.mockReset();
    mocks.deleteUser.mockReset().mockResolvedValue(undefined);
    mocks.getAuth.mockReset().mockReturnValue({ deleteUser: mocks.deleteUser });
  });

  it('認証失敗（AuthError）は 401・削除しない', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    const { db, store } = makeDb({ 'account_users/u1': { handle: 'me' } });
    mocks.getDb.mockReturnValue(db);
    const r = await POST(req());
    expect(r.status).toBe(401);
    expect(store['account_users/u1']).toBeDefined();      // 不変
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('非 owner メンバー: 自分のデータのみ削除・WS は残す・他人の doc は不変', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'myhandle' },
      'profile_pages/myhandle': { uid: 'u1' },
      'account_subscriptions/u1': { purchasedCredits: 10 },
      'account_google_tokens/u1': { token: 'x' },
      'notification_push_tokens/u1': { token: 'y' },
      'account_ai_usage/u1': { total: 1 },
      'account_ai_usage/u1/monthly/2026-07': { used: 3 },
      'personal_reminders/rem1': { ownerUid: 'u1' },
      'personal_reminders/rem2': { ownerUid: 'other' }, // 他人の reminder
      'shop_shops/ws2': { ownerUid: 'boss' },            // u1 は非 owner
      'shop_shops/ws2/members/u1': { role: 'cast' },
      // 他ユーザーの account（IDOR で消えないこと）
      'account_users/u2': { handle: 'other' },
    });
    mocks.getDb.mockReturnValue(db);

    const r = await POST(req());
    expect(await r.json()).toEqual({ success: true });

    // 自分のデータは消える
    for (const p of [
      'account_users/u1', 'profile_pages/myhandle', 'account_subscriptions/u1',
      'account_google_tokens/u1', 'notification_push_tokens/u1',
      'account_ai_usage/u1', 'account_ai_usage/u1/monthly/2026-07',
      'personal_reminders/rem1', 'shop_shops/ws2/members/u1',
    ]) expect(store[p]).toBeUndefined();

    // 他人・WS 本体は残る
    expect(store['personal_reminders/rem2']).toBeDefined(); // 他人の reminder
    expect(store['shop_shops/ws2']).toBeDefined();          // 非 owner なので WS は残す
    expect(store['account_users/u2']).toBeDefined();        // IDOR 無し

    expect(mocks.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('owner: ワークスペース doc も member doc も削除する', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'owner1' },
      'shop_shops/ws1': { ownerUid: 'u1' },
      'shop_shops/ws1/members/u1': { role: 'owner' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['shop_shops/ws1']).toBeUndefined();          // owner は WS も削除
    expect(store['shop_shops/ws1/members/u1']).toBeUndefined();
  });

  it('handle が無ければ profile_pages を触らない', async () => {
    const { db, store } = makeDb({
      'account_users/u1': {},                 // handle 無し
      'profile_pages/someoneelse': { uid: 'zzz' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['account_users/u1']).toBeUndefined();       // 本体は削除
    expect(store['profile_pages/someoneelse']).toBeDefined(); // 無関係ページは不変
    expect(mocks.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('member でない WS は何も削除しない', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'h' },
      'shop_shops/wsX': { ownerUid: 'other' }, // u1 は member 不在
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['shop_shops/wsX']).toBeDefined(); // 非メンバーの WS は不変
  });

  it('ai_usage の月次サブコレクションは複数 doc でも全削除する（batch forEach）', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'h' },
      'account_ai_usage/u1': { total: 9 },
      'account_ai_usage/u1/monthly/2026-05': { used: 1 },
      'account_ai_usage/u1/monthly/2026-06': { used: 2 },
      'account_ai_usage/u1/monthly/2026-07': { used: 3 },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    for (const p of [
      'account_ai_usage/u1', 'account_ai_usage/u1/monthly/2026-05',
      'account_ai_usage/u1/monthly/2026-06', 'account_ai_usage/u1/monthly/2026-07',
    ]) expect(store[p]).toBeUndefined();
  });

  it('owner/member/非member が混在する全走査を1回で正しく処理する', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'h' },
      'shop_shops/wsOwn': { ownerUid: 'u1' },       // owner → WS も削除
      'shop_shops/wsOwn/members/u1': { role: 'owner' },
      'shop_shops/wsMem': { ownerUid: 'boss' },     // member → WS は残す
      'shop_shops/wsMem/members/u1': { role: 'cast' },
      'shop_shops/wsNon': { ownerUid: 'x' },        // 非member → 不変
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['shop_shops/wsOwn']).toBeUndefined();            // owner WS 削除
    expect(store['shop_shops/wsOwn/members/u1']).toBeUndefined();
    expect(store['shop_shops/wsMem']).toBeDefined();              // member WS は残す
    expect(store['shop_shops/wsMem/members/u1']).toBeUndefined(); // member doc は削除
    expect(store['shop_shops/wsNon']).toBeDefined();              // 非member WS 不変
  });

  // Day82（yorulog からの指摘）: 従来は account_* と personal_reminders のフラット doc しか
  // 消しておらず、正本である personal_<name>/{uid}/items/... が丸ごと残っていた。
  // ＝ 退会後も顧客台帳・売上・AI スレッドが残る状態だった。
  it('personal_* の個人データツリーを items / standalone / messages まで消す', async () => {
    const { db, store } = makeDb({
      'account_users/u1': { handle: 'h' },
      'personal_customers/u1': {},
      'personal_customers/u1/items/c1': { name: 'あい' },
      'personal_customers/u1/items/c2': { name: 'ゆい' },
      'personal_sales/u1/items/s1': { amount: 12000 },
      'personal_sales/u1/standalone/s2': { amount: 3000 },
      'personal_ai_threads/u1/items/t1': { title: 'スレ' },
      'personal_ai_threads/u1/items/t1/messages/m1': { text: 'こんばんは' },
      'personal_templates/u1/items/tp1': { body: 'テンプレ' },
      'personal_goals/u1/items/g1': { target: 100 },
      'personal_business_cards/u1/items/b1': { name: '名刺' },
      'personal_self_styles/u1': { stageName: 'あい' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    // uid 配下は 1 件も残らない
    expect(Object.keys(store).filter((k) => /^personal_[a-z_]+\/u1(\/|$)/.test(k))).toEqual([]);
  });

  it('他ユーザーの personal_* は一切触らない（uid 単位に閉じていること）', async () => {
    const { db, store } = makeDb({
      'account_users/u1': {},
      'personal_customers/u1/items/c1': { name: '自分の客' },
      'personal_customers/u2/items/c9': { name: '他人の客' },
      'personal_self_styles/u2': { stageName: '他人' },
      // uid の前方一致で誤爆しないこと（u1 と u10 は別人）
      'personal_customers/u10/items/c5': { name: '別人' },
    });
    mocks.getDb.mockReturnValue(db);
    await POST(req());
    expect(store['personal_customers/u1/items/c1']).toBeUndefined();
    expect(store['personal_customers/u2/items/c9']).toBeDefined();
    expect(store['personal_self_styles/u2']).toBeDefined();
    expect(store['personal_customers/u10/items/c5']).toBeDefined();
  });
});
