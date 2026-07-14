import { describe, expect, it } from 'vitest';
import { calculateResult, createInitialState, type CalculatorState } from '../../src/lib/pos/engine';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';

// 会計金額の心臓部（calculateResult）の characterization + 回帰テスト。
// 既定 config（税/サービス 35%・閉店 25時=01:00・regular 早22:00 境界21時）を用いる。
const cfg = createDefaultStoreConfig();
const base: CalculatorState = { ...createInitialState(cfg), orders: [] };
const calc = (o: Partial<CalculatorState>) => calculateResult({ ...base, ...o }, cfg);

describe('calculateResult — 基本料金', () => {
  it('regular 早セット 1セット（20:00入店・現在20:00）', () => {
    // set2000 + 指名3000 + TC500 = 5500、×1.35=7425 → 十の位切上 7500
    expect(calc({ entryTime: '20:00', currentTime: '20:00' }).currentTotal).toBe(7500);
  });
  it('regular 遅セット（22:00入店＝21時境界以降で lateSet5000）', () => {
    expect(calc({ entryTime: '22:00', currentTime: '22:00' }).currentTotal).toBe(11500);
  });
  it('延長: 20:00→22:30 は 3セット（初回1+延長2）', () => {
    expect(calc({ entryTime: '20:00', currentTime: '22:30' }).currentTotal).toBe(15600);
    // ワンセット前（2セット時）の金額も返す
    expect(calc({ entryTime: '20:00', currentTime: '22:30' }).previousTotal).toBe(11500);
  });
});

describe('calculateResult — 割引/オプション', () => {
  it('セット半額はセットのみ半減（指名/TCは据え置き）', () => {
    expect(calc({ entryTime: '20:00', currentTime: '20:00', isSetHalfOff: true }).currentTotal).toBe(6100);
  });
  it('ゴールドカードはセット0/延長1000上書き（初回2セット扱い）', () => {
    expect(calc({ entryTime: '20:00', currentTime: '22:30', isGoldTicket: true }).currentTotal).toBe(6100);
  });
  it('同伴料が指名料に合算される', () => {
    expect(calc({ entryTime: '20:00', currentTime: '20:00', dohan: true }).currentTotal).toBe(11500);
  });
  it('複数指名料（1人 3000）', () => {
    expect(calc({ entryTime: '20:00', currentTime: '20:00', additionalNominationCount: 2 }).currentTotal).toBe(15600);
  });
});

describe('calculateResult — 客層別', () => {
  it('初回・注文なしは無課税レート（set3000 + 指名1000 = 4000）', () => {
    const r = calc({ customerType: 'initial', initialSetPrice: 3000, entryTime: '20:00', currentTime: '20:00' });
    expect(r.taxRate).toBe(0);
    expect(r.currentTotal).toBe(4000);
  });
  it('r_within は 2時間セット（set0・2h まで延長なし）', () => {
    expect(calc({ customerType: 'r_within', entryTime: '20:00', currentTime: '22:00' }).currentTotal).toBe(1400);
  });
});

describe('calculateResult — 営業時間外（isOutOfHours）', () => {
  it('開店前（現在19:00）は1セットに丸め・時間外フラグ', () => {
    const r = calc({ entryTime: '20:00', currentTime: '19:00' });
    expect(r.currentTotal).toBe(7500);
    expect(r.isOutOfHours).toBe(true);
  });
  it('閉店ちょうど（01:00）は有効・満額（過少請求バグの境界）', () => {
    const r = calc({ entryTime: '20:00', currentTime: '01:00' });
    expect(r.isOutOfHours).toBe(false);
    expect(r.currentTotal).toBe(23700);
  });
  it('回帰: 閉店を過ぎた会計（01:30）は1セットに潰さず閉店額でクランプ', () => {
    // 旧実装は 1 セット(7500) へ潰れて延長分が消える過少請求だった。
    // 修正後は閉店(01:00)時点の満額 23700 と一致し、時間外フラグは立てる。
    const r = calc({ entryTime: '20:00', currentTime: '01:30' });
    expect(r.currentTotal).toBe(23700);
    expect(r.isOutOfHours).toBe(true);
    expect(r.currentTotal).toBe(calc({ entryTime: '20:00', currentTime: '01:00' }).currentTotal);
  });
});
