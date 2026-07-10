import { describe, expect, it } from 'vitest';
import { balanceOf, collectPatch, isOverdue, statusChangePatch } from '../../src/lib/unpaid/logic';

// 売掛の状態遷移・回収計算（Day23 の不整合修正を固定する・Day24）

describe('statusChangePatch', () => {
  it('回収済にすると回収済額が売掛額に揃う', () => {
    expect(statusChangePatch({ amount: 30000, status: '未回収' }, '回収済'))
      .toEqual({ status: '回収済', paidAmount: 30000 });
    expect(statusChangePatch({ amount: 30000, status: '一部回収' }, '回収済'))
      .toEqual({ status: '回収済', paidAmount: 30000 });
  });

  it('回収済→未回収は回収済額をリセットして債権を再表示（Day23 修正）', () => {
    expect(statusChangePatch({ amount: 30000, status: '回収済' }, '未回収'))
      .toEqual({ status: '未回収', paidAmount: 0 });
  });

  it('回収済→一部回収もリセット（残高¥0の一部回収という矛盾を作らない）', () => {
    expect(statusChangePatch({ amount: 30000, status: '回収済' }, '一部回収'))
      .toEqual({ status: '一部回収', paidAmount: 0 });
  });

  it('回収済を経由しない遷移は回収済額を触らない（一部回収の実績を保持）', () => {
    expect(statusChangePatch({ amount: 30000, status: '一部回収' }, '未回収'))
      .toEqual({ status: '未回収' });
    expect(statusChangePatch({ amount: 30000, status: '未回収' }, '一部回収'))
      .toEqual({ status: '一部回収' });
  });
});

describe('collectPatch', () => {
  it('一部回収は加算して一部回収のまま', () => {
    expect(collectPatch({ amount: 30000, paidAmount: 5000 }, 10000))
      .toEqual({ paidAmount: 15000, status: '一部回収' });
  });

  it('満額到達で自動的に回収済', () => {
    expect(collectPatch({ amount: 30000, paidAmount: 20000 }, 10000))
      .toEqual({ paidAmount: 30000, status: '回収済' });
  });

  it('過回収は売掛額でクランプ', () => {
    expect(collectPatch({ amount: 30000, paidAmount: 25000 }, 99999))
      .toEqual({ paidAmount: 30000, status: '回収済' });
  });

  it('無効な回収額（0以下・NaN）は null', () => {
    expect(collectPatch({ amount: 30000, paidAmount: 0 }, 0)).toBeNull();
    expect(collectPatch({ amount: 30000, paidAmount: 0 }, -100)).toBeNull();
    expect(collectPatch({ amount: 30000, paidAmount: 0 }, Number('abc'))).toBeNull();
  });
});

describe('balanceOf', () => {
  it('残高 = 売掛額 − 回収済', () => {
    expect(balanceOf({ amount: 30000, paidAmount: 12000 })).toBe(18000);
  });
  it('過回収データでも負にならない（0 クランプ）', () => {
    expect(balanceOf({ amount: 30000, paidAmount: 40000 })).toBe(0);
  });
});

describe('isOverdue', () => {
  const today = '2026-07-11';
  it('期日を過ぎたら超過', () => {
    expect(isOverdue({ status: '未回収', due: '2026-07-10' }, today)).toBe(true);
    expect(isOverdue({ status: '一部回収', due: '2026-06-01' }, today)).toBe(true);
  });
  it('当日・未来・期日なしは超過ではない', () => {
    expect(isOverdue({ status: '未回収', due: '2026-07-11' }, today)).toBe(false);
    expect(isOverdue({ status: '未回収', due: '2026-07-12' }, today)).toBe(false);
    expect(isOverdue({ status: '未回収', due: null }, today)).toBe(false);
    expect(isOverdue({ status: '未回収' }, today)).toBe(false);
  });
  it('回収済は期日が過ぎていても超過扱いにしない', () => {
    expect(isOverdue({ status: '回収済', due: '2026-01-01' }, today)).toBe(false);
  });
});
