// Day8: 予約「来店済」→開卓＋POS初期伝票（buildReservationCheckin）のテスト。
import { describe, it, expect } from 'vitest';
import { buildReservationCheckin } from '../../src/lib/seating/checkin';
import { createEmptyTable, type Customer, type FloorTable } from '../../src/lib/seating/types';
import type { CalculatorState, PosSlip } from '../../src/lib/pos/engine';

const NOW = 1_800_000_000_000;

const slipState = {} as CalculatorState; // 中身は engine 側のテストで担保（ここでは伝播のみ確認）

const base = () => ({
  table: createEmptyTable('t1', 'A1'),
  seq: 3,
  now: NOW,
  guests: 2,
  customerName: '佐藤様',
  cast: { id: 'c1', name: '祐也', uid: 'uid-yuya' },
  slipId: 's_res_1',
  slipState,
});

describe('buildReservationCheckin', () => {
  it('開卓（ACTIVE・連番・正規）し、指名キャストが本指名として付く', () => {
    const p = buildReservationCheckin(base());
    expect(p.status).toBe('ACTIVE');
    expect(p.entryNumber).toBe(3);
    expect(p.startTime).toBe(NOW);
    expect(p.type).toBe('正規');
    expect(p.currentHostIds).toEqual(['c1']);
    expect(p.mainHostIds).toEqual(['c1']); // 予約指名＝本指名
    expect(p.requestedHostIds).toEqual(['c1']);
    expect(p.castStartTimes).toEqual({ c1: NOW });
    expect(p.sessionLog).toEqual([]);
    expect(p.extraMinutes).toBe(0);
  });

  it('初期伝票が担当・顧客名つきで作られる', () => {
    const p = buildReservationCheckin(base());
    const slips = p.slips as PosSlip[];
    expect(slips).toHaveLength(1);
    expect(slips[0]).toMatchObject({ id: 's_res_1', name: '佐藤様', castName: '祐也', castId: 'c1', castUid: 'uid-yuya', customerName: '佐藤様' });
  });

  it('客は人数分・名前は先頭のみ・undefined キーを一切含まない（Firestore 拒否対策）', () => {
    const p = buildReservationCheckin(base());
    const customers = p.customers as Customer[];
    expect(customers).toHaveLength(2);
    expect(customers[0].name).toBe('佐藤様');
    expect('name' in customers[1]).toBe(false);
    const hasUndefined = (v: unknown): boolean => {
      if (v === undefined) return true;
      if (Array.isArray(v)) return v.some(hasUndefined);
      if (v && typeof v === 'object') return Object.values(v).some(hasUndefined);
      return false;
    };
    expect(hasUndefined(p)).toBe(false);
  });

  it('キャスト未指定・名無しでも成立する（uid 無しキャストでは castUid キーを作らない）', () => {
    const p = buildReservationCheckin({ ...base(), cast: null, customerName: '', guests: 0 });
    expect(p.currentHostIds).toBeUndefined(); // キャスト関連は書かない＝既存を壊さない
    expect((p.customers as Customer[])).toHaveLength(1); // 0人は1人に補正
    const slips = p.slips as PosSlip[];
    expect(slips[0].name).toBe('①');
    expect('castUid' in slips[0]).toBe(false);
    const noUid = buildReservationCheckin({ ...base(), cast: { id: 'c2', name: '迅', uid: null } });
    expect('castUid' in (noUid.slips as PosSlip[])[0]).toBe(false);
  });

  it('WAITING 卓の既存伝票・着席中キャストの時刻は保持しつつ ghost は掃除される', () => {
    const t: FloorTable = {
      ...createEmptyTable('t1', 'A1'), status: 'WAITING',
      currentHostIds: ['stay'], castStartTimes: { stay: 111, ghost: 5 },
      slips: [{ id: 'old', name: '旧', state: slipState }],
    };
    const p = buildReservationCheckin({ ...base(), table: t });
    expect((p.slips as PosSlip[]).map((s) => s.id)).toEqual(['old', 's_res_1']);
    expect(p.castStartTimes).toEqual({ stay: 111, c1: NOW }); // ghost は落ちる
    expect(p.currentHostIds).toEqual(['stay', 'c1']);
  });
});
