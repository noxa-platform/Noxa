// 席回し純ロジックのテスト（追加A: バグ総ざらいで固定した不変条件）。
import { describe, it, expect } from 'vitest';
import {
  computeCasts, rotateOrder, nextDailySequence, canStartSet,
  removeCastPatch, buildAssignPatches, toggleInArray,
} from '../../src/lib/seating/logic';
import { createEmptyTable, type FloorTable } from '../../src/lib/seating/types';

const cast = (id: string, base: 'Free' | 'Break' | 'Absent' = 'Free') => ({
  id, name: id, rank: '非役職' as const, hourlyWage: 5000, isLocked: false, baseStatus: base,
});

const table = (id: string, over: Partial<FloorTable> = {}): FloorTable =>
  ({ ...createEmptyTable(id, id), ...over });

describe('computeCasts（卓配置が正）', () => {
  it('卓に着いているキャストは Work、他は baseStatus', () => {
    const tables = [table('t1', { currentHostIds: ['a'] })];
    const result = computeCasts([cast('a'), cast('b', 'Break')], tables);
    expect(result.find((c) => c.id === 'a')?.status).toBe('Work');
    expect(result.find((c) => c.id === 'a')?.currentTableId).toBe('t1');
    expect(result.find((c) => c.id === 'b')?.status).toBe('Break');
  });
});

describe('rotateOrder', () => {
  it('先頭が末尾へ回る', () => {
    expect(rotateOrder(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
  });
  it('2人未満は変化しない', () => {
    expect(rotateOrder(['a'])).toEqual(['a']);
    expect(rotateOrder([])).toEqual([]);
  });
});

describe('nextDailySequence（営業日リセット）', () => {
  it('同じ営業日は連番が進む', () => {
    expect(nextDailySequence({ dailySequence: 5, dayKey: '2026-07-03' }, '2026-07-03')).toBe(6);
  });
  it('営業日が変わったら 1 に戻る（旧実装は無限に増え続けるバグ）', () => {
    expect(nextDailySequence({ dailySequence: 42, dayKey: '2026-07-02' }, '2026-07-03')).toBe(1);
  });
  it('meta 無し・旧形式(dayKey無し)は 1 から', () => {
    expect(nextDailySequence(undefined, '2026-07-03')).toBe(1);
    expect(nextDailySequence({ dailySequence: 9 }, '2026-07-03')).toBe(1);
  });
});

describe('canStartSet（二重セット防止）', () => {
  it('EMPTY/WAITING は開始可', () => {
    expect(canStartSet('EMPTY')).toBe(true);
    expect(canStartSet('WAITING')).toBe(true);
  });
  it('ACTIVE/CHECK は開始不可（先客の customers を潰さない）', () => {
    expect(canStartSet('ACTIVE')).toBe(false);
    expect(canStartSet('CHECK')).toBe(false);
  });
});

describe('removeCastPatch', () => {
  it('current/main から外し castStartTimes も消す。他フィールドはパッチに含めない', () => {
    const t = table('t1', {
      currentHostIds: ['a', 'b'], mainHostIds: ['a'], castStartTimes: { a: 100, b: 200 },
      slips: [{ id: 'slip1' } as never],
    });
    const patch = removeCastPatch(t, 'a');
    expect(patch.currentHostIds).toEqual(['b']);
    expect(patch.mainHostIds).toEqual([]);
    expect(patch.castStartTimes).toEqual({ b: 200 });
    // slips や customers を含まない＝POS 伝票を巻き戻さない（旧実装の P0 バグ）
    expect('slips' in patch).toBe(false);
    expect('customers' in patch).toBe(false);
  });
});

describe('buildAssignPatches（1キャスト=1卓の不変条件）', () => {
  it('別卓に居るキャストを移すと、旧卓から引き剥がすパッチも出る', () => {
    const tables = [
      table('t1', { currentHostIds: ['a'], mainHostIds: ['a'], castStartTimes: { a: 100 } }),
      table('t2'),
    ];
    const patches = buildAssignPatches(tables, 't2', 'a', 999);
    const t1p = patches.find((p) => p.tableId === 't1')!.patch;
    const t2p = patches.find((p) => p.tableId === 't2')!.patch;
    expect(t1p.currentHostIds).toEqual([]);
    expect(t2p.currentHostIds).toEqual(['a']);
    expect(t2p.castStartTimes).toEqual({ a: 999 });
    expect(t2p.assignedHistory).toEqual(['a']);
  });
  it('既に対象卓に居るなら変更なし（空パッチ）', () => {
    const tables = [table('t1', { currentHostIds: ['a'] })];
    expect(buildAssignPatches(tables, 't1', 'a', 999)).toEqual([]);
  });
  it('assignedHistory は重複追加しない', () => {
    const tables = [table('t1', { assignedHistory: ['a'] })];
    const patches = buildAssignPatches(tables, 't1', 'a', 999);
    expect(patches[0].patch.assignedHistory).toEqual(['a']);
  });
});

describe('toggleInArray', () => {
  it('無ければ足し、あれば外す', () => {
    expect(toggleInArray(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInArray(['a', 'b'], 'b')).toEqual(['a']);
    expect(toggleInArray(undefined, 'x')).toEqual(['x']);
  });
});
