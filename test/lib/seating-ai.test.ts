// 席回し AI（純ロジック）のテスト。追加A「純ロジックにテスト追加」の未消化回収分。
// sourcing の優先度/除外、ペアリングのランク相性、提案生成の重複抑止を固定する。
import { describe, it, expect } from 'vitest';
import {
  getSourcingCandidates, findBestPairWithScore, proposeRotation, generateAIProposals,
  type SourcingCandidate,
} from '../../src/lib/seating/ai';
import { createEmptyTable, type Cast, type FloorTable, type Rank, type CastStatus } from '../../src/lib/seating/types';

const cast = (id: string, over: Partial<Cast> = {}): Cast => ({
  id, name: id, rank: '非役職' as Rank, hourlyWage: 5000, isLocked: false,
  status: 'Free' as CastStatus, currentTableId: null, ...over,
});
const table = (id: string, over: Partial<FloorTable> = {}): FloorTable =>
  ({ ...createEmptyTable(id, id), ...over });

describe('getSourcingCandidates（除外条件と優先度）', () => {
  it('BOSS・ロック中・卓の excluded は候補に入らない（AI経路の除外はここで担保）', () => {
    const target = table('t1', { excludedHostIds: ['ex'] });
    const out = getSourcingCandidates(
      [cast('boss', { rank: 'BOSS' }), cast('locked', { isLocked: true }), cast('ex'), cast('ok')],
      [target], target,
    );
    expect(out.map((c) => c.cast.id)).toEqual(['ok']);
  });
  it('指名(requested)の待機キャストは S、通常待機は A、他卓ヘルプは B の順', () => {
    const other = table('t2', { currentHostIds: ['help'] }); // main ではない＝引き剥がし可
    const target = table('t1', { requestedHostIds: ['req'] });
    const out = getSourcingCandidates(
      [cast('req'), cast('free'), cast('help', { status: 'Work' })],
      [target, other], target,
    );
    expect(out.map((c) => `${c.cast.id}:${c.priority}`)).toEqual(['req:S', 'free:A', 'help:B']);
    expect(out.find((c) => c.cast.id === 'help')?.sourceTableId).toBe('t2');
  });
  it('本指名(main)で着席中のキャストは引き剥がし候補にならない', () => {
    const other = table('t2', { currentHostIds: ['main1'], mainHostIds: ['main1'] });
    const out = getSourcingCandidates([cast('main1', { status: 'Work' })], [other], table('t1'));
    expect(out).toEqual([]);
  });
});

describe('findBestPairWithScore（ランク相性）', () => {
  const cand = (id: string, rank: Rank, priority: 'S' | 'A' | 'B' = 'A'): SourcingCandidate =>
    ({ cast: cast(id, { rank }), priority });
  it('役職×新人が最高相性（Excellent）', () => {
    const r = findBestPairWithScore([cand('o', '役職'), cand('r', '新人'), cand('n', '非役職')])!;
    expect(r.type).toBe('Excellent');
    expect([r.cast1.id, r.cast2.id].sort()).toEqual(['o', 'r']);
  });
  it('新人×新人しかいなければ Avoid として返る（警告表示用）', () => {
    const r = findBestPairWithScore([cand('r1', '新人'), cand('r2', '新人')])!;
    expect(r.type).toBe('Avoid');
    expect(r.score).toBeLessThan(0);
  });
  it('S 指名の優先ボーナスが相性差を逆転できる', () => {
    // 役職+非役職(85) vs 非役職+非役職だが片方S指名(80+50)
    const r = findBestPairWithScore([cand('a', '非役職', 'S'), cand('b', '非役職'), cand('c', '役職', 'B')])!;
    expect([r.cast1.id, r.cast2.id].sort()).toEqual(['a', 'b']);
  });
  it('候補2未満は null', () => {
    expect(findBestPairWithScore([cand('a', '役職')])).toBeNull();
  });
});

describe('proposeRotation（ガード条件）', () => {
  it('自動ローテON・ACTIVE・2名以上のときだけ提案', () => {
    expect(proposeRotation(table('t', { innerRotationEnabled: true, status: 'ACTIVE', currentHostIds: ['a', 'b'] }))).not.toBeNull();
    expect(proposeRotation(table('t', { innerRotationEnabled: false, status: 'ACTIVE', currentHostIds: ['a', 'b'] }))).toBeNull();
    expect(proposeRotation(table('t', { innerRotationEnabled: true, status: 'EMPTY', currentHostIds: ['a', 'b'] }))).toBeNull();
    expect(proposeRotation(table('t', { innerRotationEnabled: true, status: 'ACTIVE', currentHostIds: ['a'] }))).toBeNull();
  });
});

describe('generateAIProposals（重複抑止・分岐）', () => {
  it('同一キャストを複数卓に提案しない（proposedCastIds 抑止）', () => {
    const t1 = table('t1', { status: 'ACTIVE', currentHostIds: [] });
    const t2 = table('t2', { status: 'ACTIVE', currentHostIds: [] });
    const out = generateAIProposals([t1, t2], [cast('only')]);
    const assigns = out.filter((p) => p.type === 'ASSIGN');
    expect(assigns).toHaveLength(1); // 1人しかいないので1卓分のみ
  });
  it('assignedHistory 済み・excluded のキャストは補充候補から外れる', () => {
    const t1 = table('t1', { status: 'ACTIVE', currentHostIds: [], assignedHistory: ['a'], excludedHostIds: ['b'] });
    const out = generateAIProposals([t1], [cast('a'), cast('b'), cast('c')]);
    const fill = out.find((p) => p.type === 'ASSIGN')!;
    expect(fill.castIds).toEqual(['c']);
  });
  it('非ACTIVE卓には何も提案しない', () => {
    const out = generateAIProposals([table('t1', { status: 'EMPTY' })], [cast('a')]);
    expect(out).toEqual([]);
  });
  it('初回卓(2名以上・キャスト不足)にはペア提案が出る', () => {
    const t1 = table('t1', {
      status: 'ACTIVE', type: '初回', currentHostIds: [],
      customers: [{ id: 'c1', type: '初回', entryTime: 1 }, { id: 'c2', type: '初回', entryTime: 1 }],
    });
    const out = generateAIProposals([t1], [cast('o', { rank: '役職' }), cast('r', { rank: '新人' })]);
    const pair = out.find((p) => p.id === 'pair-t1')!;
    expect(pair.castIds).toHaveLength(2);
    expect(pair.message).toContain('✨[推奨]');
  });
});
