import { describe, it, expect, beforeEach, vi } from 'vitest';

// admin/push-stats の GET を Admin SDK モックで検証する（Day87）。
// 管理者専用: 直近 N 日の Push 配信統計（notification_push_stats/{YYYY-MM-DD}）を返す。
// 固定する境界:
//   - 認証失敗=401、email 逆引き失敗=500、非管理者=403（いずれも DB を読まない/漏らさない）
//   - days クランプ [1,30]（未指定/NaN/0 は 7・負値は 1・超過は 30）→ rows 件数
//   - doc 非存在=ゼロ行、存在時は sent/failed/invalidTokenDeleted を ?? 0 で防御・byFn 透過
//
// 実バグは発見されず（管理者ゲート default-deny・クランプ健全）。本テストは executable spec。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getUser: vi.fn(), getDb: vi.fn(), isAdmin: vi.fn() }));

vi.mock('@/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminAuth: () => ({ getUser: mocks.getUser }),
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }));

import { AuthError } from '@/app/api/lib/firebase-admin';
import { GET } from '@/app/api/admin/push-stats/route';

// 全 date パスで同じ docData を返すフェイク Firestore（date 非依存でマッピングを検証）。
function makeDb(docData?: Record<string, unknown>) {
  return { doc: () => ({ get: async () => ({ exists: docData !== undefined, data: () => docData }) }) };
}
const req = (qs = '') => ({ url: `https://x/api/admin/push-stats${qs}` }) as never;

describe('admin/push-stats GET（管理者・Push 配信統計）', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue('admin-uid');
    mocks.getUser.mockReset().mockResolvedValue({ email: 'admin@example.com' });
    mocks.isAdmin.mockReset().mockReturnValue(true);
    mocks.getDb.mockReset().mockReturnValue(makeDb());
  });

  it('認証失敗（AuthError）は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('認証が必要です'));
    expect((await GET(req())).status).toBe(401);
  });

  it('email 逆引き失敗は 500', async () => {
    mocks.getUser.mockRejectedValue(new Error('user gone'));
    expect((await GET(req())).status).toBe(500);
  });

  it('非管理者は 403・DB を読まない', async () => {
    mocks.isAdmin.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('days 未指定は 7 行・全ゼロ（doc 非存在）', async () => {
    const body = await (await GET(req())).json();
    expect(body.rows).toHaveLength(7);
    expect(body.rows[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), sent: 0, failed: 0, invalidTokenDeleted: 0 });
  });

  it('days クランプ: 3→3行 / 100→30行 / 0→7行 / 負値→1行 / NaN→7行', async () => {
    expect((await (await GET(req('?days=3'))).json()).rows).toHaveLength(3);
    expect((await (await GET(req('?days=100'))).json()).rows).toHaveLength(30);
    expect((await (await GET(req('?days=0'))).json()).rows).toHaveLength(7);
    expect((await (await GET(req('?days=-5'))).json()).rows).toHaveLength(1);
    expect((await (await GET(req('?days=abc'))).json()).rows).toHaveLength(7);
  });

  it('doc 存在時は sent/failed/invalidTokenDeleted をマップし byFn を透過', async () => {
    mocks.getDb.mockReturnValue(makeDb({ sent: 12, failed: 3, invalidTokenDeleted: 1, byFn: { push_daily: { sent: 12 } } }));
    const body = await (await GET(req('?days=1'))).json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      sent: 12, failed: 3, invalidTokenDeleted: 1, byFn: { push_daily: { sent: 12 } },
    });
  });

  it('doc 存在でも欠落フィールドは ?? 0 で防御', async () => {
    mocks.getDb.mockReturnValue(makeDb({ sent: 5 }));
    const body = await (await GET(req('?days=1'))).json();
    expect(body.rows[0]).toMatchObject({ sent: 5, failed: 0, invalidTokenDeleted: 0 });
    expect(body.rows[0].byFn).toBeUndefined();
  });
});
