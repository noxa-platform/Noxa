import { describe, it, expect } from 'vitest';
import { resolveSaleAttribution } from '../../src/lib/pos/attribution';
import type { CalculatorState } from '../../src/lib/pos/engine';

/**
 * M4: 会計時の売上帰属解決のテスト。
 * 「castUid の無い伝票が操作者へ誤帰属する」旧バグの再発防止と、
 * 本指名/場内/フリー・同伴の区分確定を固定する。
 */

const state = (over: Partial<CalculatorState> = {}): CalculatorState => ({
  customerType: 'regular', initialSetPrice: 0, entryTime: '20:00', currentTime: '21:00',
  dohan: false, isSetHalfOff: false, isGirlsParty: false, isAppreciationDay: false,
  isSevenLuck: false, isGoldTicket: false, additionalNominationCount: 0, isDebugMode: false,
  orders: [], ...over,
});

const CASTS = [
  { id: 'c1', name: '祐也', uid: 'uid-yuya' },
  { id: 'c2', name: '迅', uid: null },
  { id: 'c3', name: '大和', uid: 'uid-yamato' },
];

describe('resolveSaleAttribution', () => {
  it('operator モードは常に操作者へ帰属する', () => {
    const r = resolveSaleAttribution({
      mode: 'operator', operatorUid: 'op',
      slip: { castUid: 'uid-yuya', castId: 'c1', castName: '祐也', state: state() },
      casts: CASTS,
    });
    expect(r.castUid).toBe('op');
    expect(r.castName).toBe('祐也'); // 表示上の担当は保持
  });

  it('伝票に castUid があればそれを使う', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castUid: 'uid-yuya', castId: 'c1', castName: '祐也', state: state() },
      casts: CASTS,
    });
    expect(r.castUid).toBe('uid-yuya');
  });

  it('castUid の無い伝票でも castId から名簿の uid を解決する（旧: 操作者へ誤帰属）', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castId: 'c3', castName: '大和', state: state() },
      casts: CASTS,
    });
    expect(r.castUid).toBe('uid-yamato');
    expect(r.castId).toBe('c3');
  });

  it('castId も無い伝票は castName の名簿一致で解決する', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castName: '大和', state: state() },
      casts: CASTS,
    });
    expect(r.castUid).toBe('uid-yamato');
    expect(r.castId).toBe('c3');
  });

  it('解決不能（未連携キャスト・名簿に無い名前）は従来どおり操作者へフォールバック', () => {
    const unlinked = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castId: 'c2', castName: '迅', state: state() },
      casts: CASTS,
    });
    expect(unlinked.castUid).toBe('op'); // uid 未連携
    const unknown = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castName: '存在しない', state: state() },
      casts: CASTS,
    });
    expect(unknown.castUid).toBe('op');
    expect(unknown.castName).toBe('存在しない'); // 手入力名は表示用に残す
  });

  it('会計時の担当名上書きは castId より優先される', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castUid: 'uid-yuya', castId: 'c1', castName: '祐也', state: state() },
      casts: CASTS,
      overrideCastName: '大和',
    });
    expect(r.castUid).toBe('uid-yamato');
    expect(r.castId).toBe('c3');
    expect(r.castName).toBe('大和');
  });

  it('上書き名が名簿に無い場合は元の担当へ落ちず、帰属は操作者フォールバック', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castUid: 'uid-yuya', castId: 'c1', castName: '祐也', state: state() },
      casts: CASTS,
      overrideCastName: 'フリー太郎',
    });
    // 名簿一致しない上書き → 旧担当の uid を使うと「名前と帰属がズレる」ため使わない
    expect(r.castUid).toBe('op');
    expect(r.castName).toBe('フリー太郎');
  });

  it('指名区分: 本指名（mainHostIds に担当が居る）/ 場内 / フリー', () => {
    const base = { mode: 'mainCast' as const, operatorUid: 'op', casts: CASTS };
    const main = resolveSaleAttribution({ ...base, slip: { castId: 'c1', castName: '祐也', castUid: 'uid-yuya', state: state() }, mainHostIds: ['c1'] });
    expect(main.nomination).toBe('main');
    const inTable = resolveSaleAttribution({ ...base, slip: { castId: 'c1', castName: '祐也', castUid: 'uid-yuya', state: state() }, mainHostIds: ['c3'] });
    expect(inTable.nomination).toBe('inTable');
    const free = resolveSaleAttribution({ ...base, slip: { state: state() } });
    expect(free.nomination).toBe('free');
  });

  it('同伴フラグは伝票 state から引き継ぐ', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op',
      slip: { castId: 'c1', castName: '祐也', castUid: 'uid-yuya', state: state({ dohan: true }) },
      casts: CASTS,
    });
    expect(r.dohan).toBe(true);
  });
});
