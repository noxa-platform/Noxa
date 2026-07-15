import { describe, it, expect } from 'vitest';
import { stockStatus, keepExpiryStatus } from '../../src/lib/inventory/status';

describe('stockStatus', () => {
  it('qty<=0 は out（発注切れ）', () => {
    expect(stockStatus(0, 10)).toBe('out');
    expect(stockStatus(-3, 10)).toBe('out'); // 異常値でも out 側
  });
  it('適正在庫(par)を下回れば low', () => {
    expect(stockStatus(5, 10)).toBe('low');
    expect(stockStatus(9, 10)).toBe('low');
  });
  it('par 以上は ok（ちょうど par は ok）', () => {
    expect(stockStatus(10, 10)).toBe('ok');
    expect(stockStatus(20, 10)).toBe('ok');
  });
  it('par<=0（発注点未設定）は low を出さない＝out のみ', () => {
    expect(stockStatus(1, 0)).toBe('ok');   // 在庫あり＝アラート無し
    expect(stockStatus(0, 0)).toBe('out');  // 切れは out
  });
});

describe('keepExpiryStatus', () => {
  const now = new Date('2026-07-15T20:00:00').getTime();

  it('期限なし（空）は none', () => {
    expect(keepExpiryStatus('', now)).toBe('none');
  });
  it('期限日翌0時を過ぎたら expired（何ヶ月も前は当然 expired）', () => {
    expect(keepExpiryStatus('2026-07-14', now)).toBe('expired'); // 前日＝翌0時経過
    expect(keepExpiryStatus('2026-04-01', now)).toBe('expired'); // 3ヶ月前
  });
  it('期限日当日はまだ有効で near（0時〜翌0時前）', () => {
    expect(keepExpiryStatus('2026-07-15', now)).toBe('near');
  });
  it('残り7日以内は near、8日以上先は none', () => {
    expect(keepExpiryStatus('2026-07-22', now)).toBe('near'); // 7日先
    expect(keepExpiryStatus('2026-07-23', now)).toBe('none'); // 8日先
    expect(keepExpiryStatus('2026-09-01', now)).toBe('none');
  });
  it('不正な日付文字列は none（クラッシュしない）', () => {
    expect(keepExpiryStatus('not-a-date', now)).toBe('none');
  });
});
