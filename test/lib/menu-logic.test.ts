// 初回案内 → 席回し反映パッチ（M3: 非Tx巻き戻り事故の根絶に伴う純関数化）のテスト。
import { describe, it, expect } from 'vitest';
import { buildFirstVisitPatch, type FirstVisitTableDoc } from '../../src/lib/menu/logic';

const NOW = 1_700_000_000_000;

describe('buildFirstVisitPatch', () => {
  it('空席卓に指名が入ると初回として開卓し、タイマーが始まる', () => {
    const p = buildFirstVisitPatch({}, ['c1', 'c2'], ['c1', 'c2', 'c3'], NOW);
    expect(p.status).toBe('ACTIVE');
    expect(p.startTime).toBe(NOW);
    expect(p.entryTime).toBe(NOW);
    expect(p.type).toBe('初回');
    expect(p.currentHostIds).toEqual(['c1', 'c2']);
    expect(p.requestedHostIds).toEqual(['c1', 'c2']);
    expect(p.assignedHistory).toEqual(['c1', 'c2']);
    expect(p.castStartTimes).toEqual({ c1: NOW, c2: NOW });
  });

  it('使用中の卓には開卓フィールドを混ぜない（既存の来店を上書きしない）', () => {
    const tdoc: FirstVisitTableDoc = { status: 'ACTIVE', currentHostIds: ['c9'], castStartTimes: { c9: 111 } };
    const p = buildFirstVisitPatch(tdoc, ['c1'], ['c1', 'c2'], NOW);
    expect(p.status).toBeUndefined();
    expect(p.startTime).toBeUndefined();
    expect(p.type).toBeUndefined();
    expect(p.currentHostIds).toEqual(['c9', 'c1']);
    expect(p.castStartTimes).toEqual({ c9: 111, c1: NOW }); // 既存の着席時刻は保持
  });

  it('表示パネルのうち選ばれなかったキャストはこの卓の除外に入る', () => {
    const p = buildFirstVisitPatch({}, ['c1'], ['c1', 'c2', 'c3'], NOW);
    expect(p.excludedHostIds.sort()).toEqual(['c2', 'c3']);
  });

  it('前回除外されたキャストが今回選ばれたら除外から外れる', () => {
    const tdoc: FirstVisitTableDoc = { status: 'ACTIVE', excludedHostIds: ['c1', 'c2'] };
    const p = buildFirstVisitPatch(tdoc, ['c1'], ['c1', 'c3'], NOW);
    expect(p.excludedHostIds).not.toContain('c1');
    expect(p.excludedHostIds).toContain('c2'); // 過去の除外は維持
    expect(p.excludedHostIds).toContain('c3'); // 今回未選択
  });

  it('重複追加しない（同キャストの再指名は配列を汚さない）', () => {
    const tdoc: FirstVisitTableDoc = {
      status: 'ACTIVE', currentHostIds: ['c1'], requestedHostIds: ['c1'], assignedHistory: ['c1'],
      castStartTimes: { c1: 222 },
    };
    const p = buildFirstVisitPatch(tdoc, ['c1'], ['c1'], NOW);
    expect(p.currentHostIds).toEqual(['c1']);
    expect(p.requestedHostIds).toEqual(['c1']);
    expect(p.assignedHistory).toEqual(['c1']);
    expect(p.castStartTimes).toEqual({ c1: 222 }); // 再指名で着席時刻を巻き戻さない
  });
});
