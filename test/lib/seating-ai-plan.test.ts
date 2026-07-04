// M5: AI 席回し提案（/api/ai/seating-suggest 応答）の制約バリデーションのテスト。
// AI の柔軟解釈 × 純ロジックの制約充足ハイブリッドの「制約」側を固定する。
import { describe, it, expect } from 'vitest';
import { sanitizeAiPlan } from '../../src/lib/seating/ai';
import { createEmptyTable, type Cast, type FloorTable } from '../../src/lib/seating/types';

const cast = (id: string, over: Partial<Cast> = {}): Cast => ({
  id, name: id, rank: '非役職', hourlyWage: 5000, status: 'Free', isLocked: false, ...over,
});

const CASTS = [
  cast('a'), cast('b'),
  cast('boss', { rank: 'BOSS' }),
  cast('locked', { isLocked: true }),
  cast('absent', { status: 'Absent' }),
  cast('mainStar', { status: 'Work' }),
];

const t1: FloorTable = { ...createEmptyTable('t1', 'A'), status: 'ACTIVE', currentHostIds: ['mainStar'], mainHostIds: ['mainStar'] };
const t2: FloorTable = { ...createEmptyTable('t2', 'B'), status: 'ACTIVE', excludedHostIds: ['b'] };
const t3: FloorTable = { ...createEmptyTable('t3', 'C'), status: 'ACTIVE', currentHostIds: ['x1', 'x2'] };
const TABLES = [t1, t2, t3];

describe('sanitizeAiPlan', () => {
  it('正常な assign / rotate を通す', () => {
    const plan = sanitizeAiPlan([
      { tableId: 't2', action: 'assign', castIds: ['a'], reason: 'ok' },
      { tableId: 't3', action: 'rotate', castIds: [], reason: 'ローテ' },
    ], CASTS, TABLES);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ tableId: 't2', action: 'assign', castIds: ['a'], reason: 'ok' });
    expect(plan[1].action).toBe('rotate');
  });

  it('BOSS/ロック/欠勤/卓の除外リスト入りは配置候補から落ちる', () => {
    const plan = sanitizeAiPlan([
      { tableId: 't2', action: 'assign', castIds: ['boss', 'locked', 'absent', 'b', 'a'], reason: '' },
    ], CASTS, TABLES);
    expect(plan).toHaveLength(1);
    expect(plan[0].castIds).toEqual(['a']); // b は t2 の excluded
  });

  it('他卓の本指名は引き剥がさない・全滅した提案は捨てる', () => {
    const plan = sanitizeAiPlan([
      { tableId: 't2', action: 'assign', castIds: ['mainStar'], reason: '' },
    ], CASTS, TABLES);
    expect(plan).toHaveLength(0);
  });

  it('既にその卓に居るキャストの再配置・2人未満卓の rotate は捨てる', () => {
    const plan = sanitizeAiPlan([
      { tableId: 't1', action: 'assign', castIds: ['mainStar'], reason: '' },
      { tableId: 't1', action: 'rotate', castIds: [], reason: '' }, // 1人
    ], CASTS, TABLES);
    expect(plan).toHaveLength(0);
  });

  it('壊れた応答（非配列・不正型・未知の卓/キャスト）に耐える', () => {
    expect(sanitizeAiPlan(undefined, CASTS, TABLES)).toEqual([]);
    expect(sanitizeAiPlan('junk', CASTS, TABLES)).toEqual([]);
    expect(sanitizeAiPlan([
      null, 42, { tableId: 'nope', action: 'assign', castIds: ['a'] },
      { tableId: 't2', action: 'explode', castIds: ['a'] },
      { tableId: 't2', action: 'assign', castIds: ['ghost'] },
    ], CASTS, TABLES)).toEqual([]);
  });

  it('提案は最大5件・reason は120字に切る', () => {
    const items = Array.from({ length: 8 }, () => ({ tableId: 't2', action: 'assign', castIds: ['a'], reason: 'あ'.repeat(200) }));
    const plan = sanitizeAiPlan(items, CASTS, TABLES);
    expect(plan).toHaveLength(5);
    expect(plan[0].reason).toHaveLength(120);
  });
});
