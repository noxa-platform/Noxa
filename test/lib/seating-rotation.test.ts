// M2: 回す順番キュー・初回ピックアップ・回し履歴のテスト。
import { describe, it, expect } from 'vitest';
import {
  orderedRotationQueue, moveInOrder, sendToBackOfOrder, firstVisitPickupSet,
  removeCastPatch, buildAssignPatches, SESSION_LOG_LIMIT,
} from '../../src/lib/seating/logic';
import { createEmptyTable, type Cast, type FloorTable } from '../../src/lib/seating/types';

const cast = (id: string, over: Partial<Cast> = {}): Cast => ({
  id, name: id, rank: '非役職', hourlyWage: 5000, status: 'Free', isLocked: false, ...over,
});

describe('orderedRotationQueue', () => {
  const casts = [cast('a'), cast('b'), cast('c'), cast('boss', { rank: 'BOSS' }), cast('lock', { isLocked: true }), cast('work', { status: 'Work' })];

  it('rotationOrder の並びで Free のみ返し、BOSS/ロック/在卓は出さない', () => {
    const q = orderedRotationQueue(['c', 'a', 'b'], casts);
    expect(q.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('並びに無いキャストは末尾へ（新規追加・卓から戻った人）', () => {
    const q = orderedRotationQueue(['b'], casts);
    expect(q[0].id).toBe('b');
    expect(q.map((c) => c.id).slice(1).sort()).toEqual(['a', 'c']);
  });

  it('order 未設定でも安全（登録順のまま）', () => {
    expect(orderedRotationQueue(undefined, casts).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveInOrder / sendToBackOfOrder', () => {
  it('上下移動し、端では変化しない', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('卓へ付いた人は最後尾へ回る', () => {
    expect(sendToBackOfOrder(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(sendToBackOfOrder(undefined, 'x')).toEqual(['x']);
  });
});

describe('firstVisitPickupSet', () => {
  it('初回系卓の requestedHostIds のみ集める', () => {
    const t1: FloorTable = { ...createEmptyTable('t1', 'A'), status: 'ACTIVE', type: '初回', requestedHostIds: ['a', 'b'] };
    const t2: FloorTable = { ...createEmptyTable('t2', 'B'), status: 'ACTIVE', type: '正規', requestedHostIds: ['c'] };
    const t3: FloorTable = { ...createEmptyTable('t3', 'C'), status: 'EMPTY', type: '初回', requestedHostIds: ['d'] }; // 空卓は対象外
    const s = firstVisitPickupSet([t1, t2, t3]);
    expect([...s].sort()).toEqual(['a', 'b']);
  });
});

describe('回し履歴（sessionLog）', () => {
  const base = (): FloorTable => ({
    ...createEmptyTable('t1', 'A'), status: 'ACTIVE',
    currentHostIds: ['a', 'b'], castStartTimes: { a: 1000, b: 2000 },
  });

  it('removeCastPatch に now を渡すと退席が履歴に載る', () => {
    const p = removeCastPatch(base(), 'a', 61_000);
    expect(p.sessionLog).toEqual([{ castId: 'a', start: 1000, end: 61_000 }]);
  });

  it('now 無し（互換呼び出し）や未着席キャストでは履歴を書かない', () => {
    expect(removeCastPatch(base(), 'a').sessionLog).toBeUndefined();
    expect(removeCastPatch(base(), 'zzz', 61_000).sessionLog).toBeUndefined();
  });

  it('引き剥がし配置（buildAssignPatches）でも移動元の卓に履歴が残る', () => {
    const from = base();
    const to: FloorTable = { ...createEmptyTable('t2', 'B'), status: 'ACTIVE' };
    const patches = buildAssignPatches([from, to], 't2', 'a', 90_000);
    const fromPatch = patches.find((p) => p.tableId === 't1')!.patch;
    expect(fromPatch.sessionLog).toEqual([{ castId: 'a', start: 1000, end: 90_000 }]);
  });

  it('履歴は上限で古い方から切り捨てられる', () => {
    const t = base();
    t.sessionLog = Array.from({ length: SESSION_LOG_LIMIT }, (_, i) => ({ castId: `c${i}`, start: i, end: i + 1 }));
    const p = removeCastPatch(t, 'a', 99_000);
    expect(p.sessionLog).toHaveLength(SESSION_LOG_LIMIT);
    expect(p.sessionLog![0].castId).toBe('c1'); // 最古(c0)が落ちる
    expect(p.sessionLog![SESSION_LOG_LIMIT - 1]).toEqual({ castId: 'a', start: 1000, end: 99_000 });
  });
});
