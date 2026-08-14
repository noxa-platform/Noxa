import { describe, it, expect, vi } from 'vitest';
import { runOperation } from '../../src/lib/operation-error';

// 「操作（書き込み）の失敗」を画面へ届ける共通経路（Day117）。
//
// 席回し・POS・初回案内は卓や伝票の操作を JSX から**投げっぱなし**で呼んでいた
// （`onClick={() => store.checkTable(t.id)}`）。await も catch も無いので、権限エラーや
// オフラインで落ちても画面には何も出ず、接客中に「押しても無反応」にしか見えなかった。
// ストア側の書き込みをこの関数で包み、①失敗を必ず通知する ②成功可否を boolean で返す
// ③呼び出し側へ throw しない、を固定する。

describe('runOperation（操作の失敗を必ず画面へ渡す）', () => {
  it('成功したら true を返し、前回の失敗表示を消す', async () => {
    const notify = vi.fn();
    const op = vi.fn().mockResolvedValue(undefined);

    await expect(runOperation('会計', op, notify)).resolves.toBe(true);
    expect(op).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(null); // 成功で古いエラーが残らない
  });

  it('★失敗したら false を返し、現場向けの文言を通知する（押しても無反応にしない）', async () => {
    const notify = vi.fn();
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

    await expect(runOperation('会計', () => Promise.reject(denied), notify)).resolves.toBe(false);

    const msg = notify.mock.calls[0][0] as string;
    expect(msg).toContain('会計に失敗しました');       // 何の操作が落ちたか
    expect(msg).toContain('権限がありません');          // 何が起きたか（describeFirestoreError 経由）
  });

  it('★呼び出し側へ throw しない（JSX の投げっぱなし呼び出しを未処理の rejection にしない）', async () => {
    const notify = vi.fn();
    // 失敗しても reject しないこと自体を確認する（reject すると Uncaught (in promise) になる）
    const result = await runOperation('卓の会計', () => Promise.reject(new Error('boom')), notify);
    expect(result).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('Error でない値を投げられても文言を作って false を返す', async () => {
    const notify = vi.fn();
    await expect(runOperation('伝票の破棄', () => Promise.reject('文字列'), notify)).resolves.toBe(false);
    expect(typeof notify.mock.calls[0][0]).toBe('string');
    expect(notify.mock.calls[0][0]).toContain('伝票の破棄に失敗しました');
  });

  it('同期的に throw する op でも捕まえる（Promise を返す前に落ちる形）', async () => {
    const notify = vi.fn();
    await expect(runOperation('開卓', () => { throw new Error('sync'); }, notify)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
