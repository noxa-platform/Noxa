import { describe, it, expect, beforeEach, vi } from 'vitest';

// tryClaimMission の受領→付与の順序と、付与失敗時の巻き戻し（Day38）を
// モジュール境界のモックで検証する。Admin SDK・credits・FieldValue を差し替え、
// フェイク Firestore（ネスト merge＋delete sentinel）で claimed フラグの遷移を観測する。

const mocks = vi.hoisted(() => ({
  getAdminDb: vi.fn(),
  grantBonusCredits: vi.fn(),
}));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getAdminDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('../../src/app/api/lib/credits', () => ({
  grantBonusCredits: mocks.grantBonusCredits,
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ST__', delete: () => '__DELETE__' },
}));

import { tryClaimMission } from '../../src/app/api/missions/lib';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** tryClaimMission が触る doc/tx だけを持つ最小フェイク Firestore */
function makeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown>> = clone(initial);
  const deepMerge = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === '__DELETE__') { delete target[k]; }
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const child = (target[k] && typeof target[k] === 'object' ? target[k] : {}) as Record<string, unknown>;
        deepMerge(child, v as Record<string, unknown>);
        target[k] = child;
      } else { target[k] = v; }
    }
  };
  const applyMerge = (path: string, data: Record<string, unknown>) => {
    const cur = store[path] ? clone(store[path]) : {};
    deepMerge(cur, data);
    store[path] = cur;
  };
  const makeRef = (path: string) => ({ path, set: async (data: Record<string, unknown>) => applyMerge(path, data) });
  const db = {
    doc: (path: string) => makeRef(path),
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({
      get: async (ref: { path: string }) => ({ exists: !!store[ref.path], data: () => store[ref.path] }),
      set: (ref: { path: string }, data: Record<string, unknown>) => applyMerge(ref.path, data),
    }),
  };
  return { db, store };
}

const PATH = 'reward_missions/u1';

describe('tryClaimMission（受領→付与の順序と巻き戻し）', () => {
  beforeEach(() => {
    mocks.grantBonusCredits.mockReset();
    mocks.getAdminDb.mockReset();
  });

  it('未受領→付与成功: granted=報酬額、claimed が立つ', async () => {
    const { db, store } = makeDb();
    mocks.getAdminDb.mockReturnValue(db);
    mocks.grantBonusCredits.mockResolvedValue(undefined);

    const r = await tryClaimMission('u1', 'first_customer');
    expect(r).toEqual({ granted: 5, alreadyClaimed: false, missionId: 'first_customer' });
    expect(mocks.grantBonusCredits).toHaveBeenCalledTimes(1);
    expect(mocks.grantBonusCredits).toHaveBeenCalledWith('u1', 5);
    expect((store[PATH]?.claimed as Record<string, unknown>)?.first_customer).toBeTruthy();
  });

  it('付与失敗: 例外を rethrow し、claimed を巻き戻す（再受領可能に）', async () => {
    const { db, store } = makeDb();
    mocks.getAdminDb.mockReturnValue(db);
    mocks.grantBonusCredits.mockRejectedValue(new Error('grant failed'));

    await expect(tryClaimMission('u1', 'first_customer')).rejects.toThrow('grant failed');
    expect(mocks.grantBonusCredits).toHaveBeenCalledTimes(1);
    // 巻き戻しで claimed.first_customer が消える＝再受領をブロックしない（報酬消失を防ぐ）
    expect((store[PATH]?.claimed as Record<string, unknown> | undefined)?.first_customer).toBeUndefined();
  });

  it('既に受領済み: 冪等に何もしない（付与を呼ばない）', async () => {
    const { db } = makeDb({ [PATH]: { claimed: { first_customer: '__ST__' } } });
    mocks.getAdminDb.mockReturnValue(db);

    const r = await tryClaimMission('u1', 'first_customer');
    expect(r).toEqual({ granted: 0, alreadyClaimed: true, missionId: 'first_customer' });
    expect(mocks.grantBonusCredits).not.toHaveBeenCalled();
  });

  it('不明なミッション ID: noop（付与を呼ばない）', async () => {
    const { db } = makeDb();
    mocks.getAdminDb.mockReturnValue(db);

    const r = await tryClaimMission('u1', 'nope');
    expect(r).toEqual({ granted: 0, alreadyClaimed: false, missionId: 'nope' });
    expect(mocks.grantBonusCredits).not.toHaveBeenCalled();
  });
});
