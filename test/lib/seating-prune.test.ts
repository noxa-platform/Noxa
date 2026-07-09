// PM レビュー修正: castStartTimes の ghost キー一掃（pruneCastStartTimes）のテスト。
// 背景: set(merge:true) はマップを深マージするため、キーを消したパッチを書いても
// Firestore 上では削除されない。書込側は update に統一し、来店開始時にこの関数で
// 現在着席中のキャスト以外の時刻を落とす（過去データの ghost も次の来店で自然回復）。
import { describe, it, expect } from 'vitest';
import { pruneCastStartTimes } from '../../src/lib/seating/logic';

describe('pruneCastStartTimes', () => {
  it('現在着席中のキャストの時刻だけ残す', () => {
    expect(pruneCastStartTimes({ a: 100, ghost: 50, b: 200 }, ['a', 'b'])).toEqual({ a: 100, b: 200 });
  });
  it('全員外れていれば空になる（前の来店の時刻を引き継がない）', () => {
    expect(pruneCastStartTimes({ ghost1: 1, ghost2: 2 }, [])).toEqual({});
  });
  it('undefined・壊れた値（数値以外）に耐える', () => {
    expect(pruneCastStartTimes(undefined, ['a'])).toEqual({});
    expect(pruneCastStartTimes({ a: 100 }, undefined)).toEqual({});
    expect(pruneCastStartTimes({ a: 'broken' as unknown as number, b: 5 }, ['a', 'b'])).toEqual({ b: 5 });
  });
});
