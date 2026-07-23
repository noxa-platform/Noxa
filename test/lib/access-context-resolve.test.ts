import { describe, it, expect, beforeEach, vi } from 'vitest';

// resolveAccessContext の3分岐（shop owner/member 判定・personal 判定・拒否）を
// Admin SDK モックで裏取りする（Day65）。この関数は Firestore rules をバイパスする
// Admin SDK 経路の**唯一のテナント境界**——「個人ユーザーが shop データに触れる」
// 「shop メンバーが他人の personal データに触れる」を default-deny で構造的に防ぐ。
// Day38-PM の missions-claim.test と同じ vi.mock + フェイク Firestore 方式を横展開。

const mocks = vi.hoisted(() => ({ getAdminDb: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getAdminDb,
  AuthError: class AuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AuthError';
    }
  },
}));

import { resolveAccessContext } from '../../src/app/api/lib/access-context';

/** resolveAccessContext が触る doc().get() だけを持つ最小フェイク Firestore。
 *  store[path] === undefined を「存在しない doc」とみなす。get したパスを記録し、
 *  余計な読み取り（owner 確定後の member クエリ等）が無いことも検証できるようにする。 */
function makeDb(store: Record<string, Record<string, unknown> | undefined>) {
  const gets: string[] = [];
  const db = {
    doc: (path: string) => ({
      get: async () => {
        gets.push(path);
        const d = store[path];
        return { exists: d !== undefined, data: () => d };
      },
    }),
  };
  return { db, gets };
}

describe('resolveAccessContext（テナント境界の3分岐）', () => {
  beforeEach(() => {
    mocks.getAdminDb.mockReset();
  });

  it('shop owner: ownerUid 一致で owner を返し、member doc は読まない（owner 優先・1 read）', async () => {
    const { db, gets } = makeDb({ 'shop_shops/S1': { ownerUid: 'U1' } });
    mocks.getAdminDb.mockReturnValue(db);

    const ctx = await resolveAccessContext('U1', 'S1');
    expect(ctx).toEqual({ kind: 'shop', shopId: 'S1', uid: 'U1', role: 'owner' });
    // owner 確定後に members/{uid} を読みに行かない（無駄読みなし・owner が member 判定に優先）
    expect(gets).toEqual(['shop_shops/S1']);
  });

  it('shop member: owner でなくても members/{uid} があれば member', async () => {
    const { db, gets } = makeDb({
      'shop_shops/S1': { ownerUid: 'OWNER' },
      'shop_shops/S1/members/U1': { role: 'staff' },
    });
    mocks.getAdminDb.mockReturnValue(db);

    const ctx = await resolveAccessContext('U1', 'S1');
    expect(ctx).toEqual({ kind: 'shop', shopId: 'S1', uid: 'U1', role: 'member' });
    expect(gets).toEqual(['shop_shops/S1', 'shop_shops/S1/members/U1']);
  });

  it('shop 存在・非 owner 非 member: AuthError で拒否（情報漏洩防止）', async () => {
    const { db } = makeDb({ 'shop_shops/S1': { ownerUid: 'OWNER' } });
    mocks.getAdminDb.mockReturnValue(db);

    await expect(resolveAccessContext('U1', 'S1')).rejects.toThrow('この shop へのアクセス権限がありません');
  });

  it('personal: shop doc が無く workspaceId===uid なら personal（member doc は読まない）', async () => {
    const { db, gets } = makeDb({});
    mocks.getAdminDb.mockReturnValue(db);

    const ctx = await resolveAccessContext('U1', 'U1');
    expect(ctx).toEqual({ kind: 'personal', uid: 'U1' });
    // shop 不在を確認したら即 personal 判定＝members クエリは走らない
    expect(gets).toEqual(['shop_shops/U1']);
  });

  it('拒否: shop doc が無く workspaceId≠uid（他人の personal への越境）は AuthError', async () => {
    const { db } = makeDb({});
    mocks.getAdminDb.mockReturnValue(db);

    // U1 が他人 U2 の personal（workspaceId=U2）を要求 → 拒否
    await expect(resolveAccessContext('U1', 'U2')).rejects.toThrow('workspace が見つからないか、アクセス権限がありません');
  });

  it('不正な workspaceId（空文字・非文字列）は DB 到達前に AuthError', async () => {
    const { db, gets } = makeDb({});
    mocks.getAdminDb.mockReturnValue(db);

    await expect(resolveAccessContext('U1', '')).rejects.toThrow('workspaceId が不正です');
    await expect(resolveAccessContext('U1', null as unknown as string)).rejects.toThrow('workspaceId が不正です');
    await expect(resolveAccessContext('U1', 123 as unknown as string)).rejects.toThrow('workspaceId が不正です');
    // 入力バリデーションで弾くので Firestore は一切叩かない
    expect(gets).toEqual([]);
  });

  it('default-deny エッジ: shop_shops/{uid} が実在し自分が非メンバーなら、自 uid でも personal に落とさず拒否', async () => {
    // uid と衝突する shopId の shop が実在するレアケース。存在する shop の権限判定が
    // 優先され、非メンバーは拒否される（personal データを漏らさない安全側の挙動を固定）。
    const { db } = makeDb({ 'shop_shops/U1': { ownerUid: 'SOMEONE_ELSE' } });
    mocks.getAdminDb.mockReturnValue(db);

    await expect(resolveAccessContext('U1', 'U1')).rejects.toThrow('この shop へのアクセス権限がありません');
  });

  it('ownerUid 欠落の shop doc: owner 扱いにせず member 判定にフォールバック（member なら許可）', async () => {
    const { db } = makeDb({
      'shop_shops/S1': {}, // ownerUid フィールドなし（legacy doc 等）
      'shop_shops/S1/members/U1': {},
    });
    mocks.getAdminDb.mockReturnValue(db);

    const ctx = await resolveAccessContext('U1', 'S1');
    expect(ctx).toEqual({ kind: 'shop', shopId: 'S1', uid: 'U1', role: 'member' });
  });
});
