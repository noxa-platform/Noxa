import { describe, it, expect, beforeEach, vi } from 'vitest';

// パスワード再設定（Day112）。
//
// ログイン画面には前から「パスワードを忘れた？」の導線があったのに、遷移先の `/account/reset` も
// `sendPasswordResetEmail` の呼び出しもリポジトリ内に存在しなかった＝**メール＋パスワードで登録した
// 利用者は、パスワードを忘れた時点でアカウントに二度と入れなかった**。
//
// 固定する境界:
//   - 未登録メール・形式不正でも**エラーにしない**（どのメールが登録済みかを外部に晒さない＝ユーザー列挙対策）
//   - 送信上限・通信断など**再試行が要る失敗は投げる**（黙って「送信しました」にしない）

const mocks = vi.hoisted(() => ({ sendReset: vi.fn() }));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendPasswordResetEmail: mocks.sendReset,
}));

import { sendPasswordReset } from '../../src/lib/auth';

/** Firebase が投げる形の例外（code を持つ Error） */
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('sendPasswordReset', () => {
  beforeEach(() => { mocks.sendReset.mockReset().mockResolvedValue(undefined); });

  it('登録済みメールには送信を依頼する', async () => {
    await expect(sendPasswordReset('cast@noxa.app')).resolves.toBeUndefined();
    expect(mocks.sendReset).toHaveBeenCalledTimes(1);
    expect(mocks.sendReset.mock.calls[0][1]).toBe('cast@noxa.app');
  });

  it('★未登録メールでもエラーにしない（登録済みかどうかを外部に教えない）', async () => {
    mocks.sendReset.mockRejectedValue(authError('auth/user-not-found'));
    await expect(sendPasswordReset('unknown@example.com')).resolves.toBeUndefined();
  });

  it('★形式不正のメールも同じ扱い（応答差で存在を推測させない）', async () => {
    mocks.sendReset.mockRejectedValue(authError('auth/invalid-email'));
    await expect(sendPasswordReset('not-an-email')).resolves.toBeUndefined();
  });

  it('送信上限は投げる（再試行が要ることを画面に出す）', async () => {
    mocks.sendReset.mockRejectedValue(authError('auth/too-many-requests'));
    await expect(sendPasswordReset('cast@noxa.app')).rejects.toMatchObject({ code: 'auth/too-many-requests' });
  });

  it('通信断は投げる（送れていないのに「送信しました」と言わない）', async () => {
    mocks.sendReset.mockRejectedValue(authError('auth/network-request-failed'));
    await expect(sendPasswordReset('cast@noxa.app')).rejects.toMatchObject({ code: 'auth/network-request-failed' });
  });

  it('code を持たない未知の例外も投げる（握り潰さない）', async () => {
    mocks.sendReset.mockRejectedValue(new Error('boom'));
    await expect(sendPasswordReset('cast@noxa.app')).rejects.toThrow('boom');
  });
});
