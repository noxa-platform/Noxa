import { describe, it, expect, beforeEach, vi } from 'vitest';

// 紹介コード発行（referral/code GET）の冪等性（Day41）を検証する。
// 核心の回帰: 発行 tx 内で ownerRef を読み直してガードし、同一ユーザーの並行初回発行でも
// コードを二重作成しない（1ユーザー=1コード）。

const mocks = vi.hoisted(() => ({
  getAdminDb: vi.fn(),
  verifyRequest: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getAdminDb,
  verifyRequest: mocks.verifyRequest,
  AuthError: class AuthError extends Error {},
}));

import { GET } from '../../src/app/api/referral/code/route';

/** full-path キーの最小フェイク Firestore。tx.get/create/set 対応。 */
function makeDb(seed: Record<string, Record<string, unknown>> = {}, opts: { ownerRaceCode?: string; uid?: string } = {}) {
  const store: Record<string, Record<string, unknown> | undefined> = { ...seed };
  const merge = (path: string, data: Record<string, unknown>) => {
    store[path] = { ...(store[path] ?? {}), ...data };
  };
  const snap = (path: string) => ({ exists: store[path] !== undefined, data: () => store[path] });
  const makeRef = (path: string) => ({
    path,
    get: async () => snap(path),
    set: async (d: Record<string, unknown>) => merge(path, d),
  });
  const db = {
    doc: (path: string) => makeRef(path),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      // 並行レース注入: tx 開始直前に別リクエストが owner コードを確定した状況を再現
      if (opts.ownerRaceCode) {
        merge(`reward_referral_owners/${opts.uid}`, { code: opts.ownerRaceCode });
      }
      return fn({
        get: async (ref: { path: string }) => snap(ref.path),
        create: (ref: { path: string }, d: Record<string, unknown>) => {
          if (store[ref.path] !== undefined) throw new Error('already exists');
          store[ref.path] = { ...d };
        },
        set: (ref: { path: string }, d: Record<string, unknown>) => merge(ref.path, d),
      });
    },
  };
  return { db, store };
}

const codeKeys = (store: Record<string, unknown>) => Object.keys(store).filter((k) => k.startsWith('reward_referral_codes/'));
const req = () => ({}) as unknown as Parameters<typeof GET>[0];

describe('referral/code GET 発行の冪等性', () => {
  beforeEach(() => {
    mocks.getAdminDb.mockReset();
    mocks.verifyRequest.mockReset();
    mocks.verifyRequest.mockResolvedValue('u1');
  });

  it('初回発行: コードを1つ作成し owner 逆引きを設定する', async () => {
    const { db, store } = makeDb();
    mocks.getAdminDb.mockReturnValue(db);

    const json = await (await GET(req())).json();
    expect(typeof json.code).toBe('string');
    expect(json.code).toHaveLength(8);
    expect(json.usedCount).toBe(0);

    const keys = codeKeys(store);
    expect(keys).toHaveLength(1); // ちょうど1コード
    expect((store[keys[0]] as { ownerUid?: string }).ownerUid).toBe('u1');
    expect((store['reward_referral_owners/u1'] as { code?: string }).code).toBe(json.code);
  });

  it('発行済み: 同じコードと usedCount を返す（新規作成しない）', async () => {
    const { db, store } = makeDb({
      'reward_referral_owners/u1': { code: 'EXIST123' },
      'reward_referral_codes/EXIST123': { ownerUid: 'u1', usedCount: 3 },
    });
    mocks.getAdminDb.mockReturnValue(db);

    const json = await (await GET(req())).json();
    expect(json).toMatchObject({ code: 'EXIST123', usedCount: 3 });
    expect(codeKeys(store)).toHaveLength(1); // 増えていない
  });

  it('並行初回発行のレース: tx 内 ownerRef ガードで二重作成しない', async () => {
    // 別リクエストが tx 直前に RACE1 を確定した状況。外側 read では未発行に見える。
    const { db, store } = makeDb(
      { 'reward_referral_codes/RACE1': { ownerUid: 'u1', usedCount: 0 } },
      { ownerRaceCode: 'RACE1', uid: 'u1' },
    );
    mocks.getAdminDb.mockReturnValue(db);

    const json = await (await GET(req())).json();
    expect(json.code).toBe('RACE1');       // 既発行を採用
    expect(codeKeys(store)).toHaveLength(1); // 新しいコードを作っていない（二重発行なし）
  });
});
