// 計算ベースの采配エンジン（generateSmartProposals）のテスト。
// 指名優先・回す順番の公平性・NG組合せ・育成ペア・采配モードの重み付けを固定する。
import { describe, it, expect } from 'vitest';
import { generateSmartProposals, isNgPair, rankPairScore } from '../../src/lib/seating/ai';
import { createEmptyTable, type Cast, type FloorTable } from '../../src/lib/seating/types';

const cast = (id: string, over: Partial<Cast> = {}): Cast => ({
  id, name: id, rank: '非役職', hourlyWage: 5000, status: 'Free', isLocked: false, ...over,
});

const activeTable = (id: string, over: Partial<FloorTable> = {}): FloorTable => ({
  ...createEmptyTable(id, id.toUpperCase()), status: 'ACTIVE',
  customers: [{ id: 'cu1', type: '正規', entryTime: 0 }], ...over,
});

describe('rankPairScore / isNgPair', () => {
  it('役職×新人=Excellent、新人×新人=Avoid', () => {
    expect(rankPairScore('役職', '新人').type).toBe('Excellent');
    expect(rankPairScore('新人', '新人').type).toBe('Avoid');
  });
  it('NG は片方向の設定でも対称に効く', () => {
    const a = cast('a', { ngCastIds: ['b'] });
    const b = cast('b');
    expect(isNgPair(a, b)).toBe(true);
    expect(isNgPair(b, a)).toBe(true);
    expect(isNgPair(b, cast('c'))).toBe(false);
  });
});

describe('generateSmartProposals', () => {
  it('指名(requested)キャストが最優先で提案される', () => {
    const casts = [cast('free1'), cast('free2'), cast('star')];
    const t = activeTable('t1', { requestedHostIds: ['star'] });
    const p = generateSmartProposals([t], casts, { rotationOrder: ['free1', 'free2', 'star'] });
    const fill = p.find((x) => x.type === 'ASSIGN')!;
    expect(fill.castIds).toEqual(['star']);
    expect(fill.reason).toContain('指名/PU');
  });

  it('balanced モードは回す順番の先頭を優先（公平性）', () => {
    const casts = [cast('a'), cast('b'), cast('c')];
    const t = activeTable('t1');
    const p = generateSmartProposals([t], casts, { rotationOrder: ['c', 'a', 'b'], mode: 'balanced' });
    const fill = p.find((x) => x.type === 'ASSIGN')!;
    expect(fill.castIds).toEqual(['c']);
    expect(fill.reason).toContain('回す順1番');
  });

  it('NG 組合せは絶対に同卓に提案しない（既存ホストとのNG）', () => {
    const casts = [cast('host', { status: 'Work' }), cast('ngGuy', { ngCastIds: ['host'] }), cast('ok')];
    // host が着席中の卓に1名補充が要る状況は作れない（hosts>0 は need 0）ので
    // 初回卓のペア選定で検証: 既存ホスト1名 + 2人目が必要
    const t = activeTable('t1', {
      type: '初回', customers: [{ id: 'c1', type: '初回', entryTime: 0 }, { id: 'c2', type: '初回', entryTime: 0 }],
      currentHostIds: ['host'],
    });
    const p = generateSmartProposals([t], casts, {});
    const fill = p.find((x) => x.type === 'ASSIGN')!;
    expect(fill.castIds).toEqual(['ok']); // ngGuy は host とNGなので除外
  });

  it('NG 同士はペアとしても組まされない', () => {
    const casts = [cast('x', { ngCastIds: ['y'] }), cast('y'), cast('z')];
    const t = activeTable('t1', { type: '初回', customers: [{ id: 'c1', type: '初回', entryTime: 0 }, { id: 'c2', type: '初回', entryTime: 0 }] });
    const p = generateSmartProposals([t], casts, { rotationOrder: ['x', 'y', 'z'] });
    const pair = p.find((x) => x.type === 'ASSIGN')!;
    expect(pair.castIds).toHaveLength(2);
    expect(pair.castIds!.sort()).not.toEqual(['x', 'y']); // x-y はNG
  });

  it('rookie モードは役職×新人の育成ペアを優先する', () => {
    const casts = [cast('officer', { rank: '役職' }), cast('rookie', { rank: '新人' }), cast('reg1'), cast('reg2')];
    const t = activeTable('t1', { type: '初回', customers: [{ id: 'c1', type: '初回', entryTime: 0 }, { id: 'c2', type: '初回', entryTime: 0 }] });
    const p = generateSmartProposals([t], casts, { mode: 'rookie', rotationOrder: ['reg1', 'reg2', 'officer', 'rookie'] });
    const pair = p.find((x) => x.type === 'ASSIGN')!;
    expect(pair.castIds!.sort()).toEqual(['officer', 'rookie']);
    expect(pair.reason).toContain('育成ペア');
  });

  it('他卓の本指名・ロック・BOSS・卓の除外は候補にならない', () => {
    const casts = [
      cast('mainStar', { status: 'Work' }),
      cast('locked', { isLocked: true }),
      cast('boss', { rank: 'BOSS' }),
      cast('banned'),
      cast('ok'),
    ];
    const other = activeTable('t0', { currentHostIds: ['mainStar'], mainHostIds: ['mainStar'] });
    const t = activeTable('t1', { excludedHostIds: ['banned'] });
    const p = generateSmartProposals([other, t], casts, {});
    const fill = p.find((x) => x.type === 'ASSIGN' && x.targetTableId === 't1')!;
    expect(fill.castIds).toEqual(['ok']);
  });

  it('席内ローテ提案は従来どおり出る', () => {
    const t = activeTable('t1', { currentHostIds: ['a', 'b'], innerRotationEnabled: true });
    const p = generateSmartProposals([t], [cast('a', { status: 'Work' }), cast('b', { status: 'Work' })], {});
    expect(p.some((x) => x.type === 'ROTATION' && x.targetTableId === 't1')).toBe(true);
  });

  it('1キャストは同一ラウンドで複数卓に提案されない', () => {
    const casts = [cast('only')];
    const t1 = activeTable('t1');
    const t2 = activeTable('t2');
    const p = generateSmartProposals([t1, t2], casts, {});
    const assigns = p.filter((x) => x.type === 'ASSIGN');
    expect(assigns).toHaveLength(1);
  });
});
