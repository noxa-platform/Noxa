import { describe, it, expect } from 'vitest';
import { setLikeKey } from '../../src/lib/community/like-state';

// いいね表示集合の遷移（楽観更新＋失敗時ロールバックで共用）の回帰。

describe('setLikeKey', () => {
  it('liked=true は key を追加する', () => {
    const next = setLikeKey(new Set(['a']), 'b', true);
    expect([...next].sort()).toEqual(['a', 'b']);
  });

  it('liked=false は key を削除する', () => {
    const next = setLikeKey(new Set(['a', 'b']), 'b', false);
    expect([...next]).toEqual(['a']);
  });

  it('冪等: 既に在る key を true / 無い key を false は不変内容', () => {
    expect([...setLikeKey(new Set(['a']), 'a', true)]).toEqual(['a']);
    expect([...setLikeKey(new Set(['a']), 'z', false)]).toEqual(['a']);
  });

  it('非破壊: 元の Set を変更せず新インスタンスを返す（React 再描画のため）', () => {
    const prev = new Set(['a']);
    const next = setLikeKey(prev, 'b', true);
    expect(next).not.toBe(prev);       // 参照が変わる
    expect([...prev]).toEqual(['a']);  // 元は不変
  });

  it('楽観更新→失敗ロールバックの往復で元に戻る', () => {
    // toggleLike の実挙動を模擬: 現在 liked=false → 楽観で true → 失敗で false へ戻す
    const key = 't:1';
    const base = new Set<string>();
    const optimistic = setLikeKey(base, key, true);   // 楽観（点ける）
    expect(optimistic.has(key)).toBe(true);
    const rolledBack = setLikeKey(optimistic, key, false); // ロールバック
    expect(rolledBack.has(key)).toBe(false);
    expect([...rolledBack]).toEqual([...base]);
  });
});
