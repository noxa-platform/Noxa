// Day8: POS会計→未収（ツケ）起票の純ロジックのテスト。
import { describe, it, expect } from 'vitest';
import { buildUnpaidEntry } from '../../src/lib/pos/unpaid';

const base = {
  customerName: '田中様', castName: '祐也', tableName: 'A1', slipName: '①',
  totalAmount: 50000, unpaidAmount: 20000, dayKey: '2026-07-05', saleId: 'sale1', operatorUid: 'op',
};

describe('buildUnpaidEntry', () => {
  it('未収額で起票され、既存の手入力台帳と同スキーマ＋出所を持つ', () => {
    const e = buildUnpaidEntry(base)!;
    expect(e).toMatchObject({
      customerName: '田中様', amount: 20000, paidAmount: 0,
      date: '2026-07-05', status: '未回収', source: 'pos', saleId: 'sale1', createdBy: 'op',
    });
    expect(String(e.memo)).toContain('卓A1');
    expect(String(e.memo)).toContain('総額¥50,000');
    expect(String(e.memo)).toContain('担当祐也');
  });

  it('未収額が総額を超えていたら総額に丸める', () => {
    expect(buildUnpaidEntry({ ...base, unpaidAmount: 99999 })!.amount).toBe(50000);
  });

  it('0以下・不正値では起票しない（null）', () => {
    expect(buildUnpaidEntry({ ...base, unpaidAmount: 0 })).toBeNull();
    expect(buildUnpaidEntry({ ...base, unpaidAmount: -100 })).toBeNull();
    expect(buildUnpaidEntry({ ...base, unpaidAmount: NaN })).toBeNull();
    expect(buildUnpaidEntry({ ...base, totalAmount: 0 })).toBeNull();
  });

  it('客名が空なら（名無し）で起票（未収は客が消えても残す）', () => {
    expect(buildUnpaidEntry({ ...base, customerName: '  ' })!.customerName).toBe('（名無し）');
    expect(buildUnpaidEntry({ ...base, customerName: null })!.customerName).toBe('（名無し）');
  });

  it('端数は切り捨てで整数化する', () => {
    const e = buildUnpaidEntry({ ...base, unpaidAmount: 1999.9 })!;
    expect(e.amount).toBe(1999);
  });
});
