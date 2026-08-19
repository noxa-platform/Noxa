import { describe, it, expect } from 'vitest';
import {
  ALL_CONCEPT_IDS, CONCEPT_DEFAULT_TERMS, CONCEPT_DESCRIPTIONS, isConceptId,
} from '../../src/lib/lexicon/concepts';
import {
  DEFAULT_NOMINATION_RULE, normalizeNominationRule, resolveNominationKind,
  type NominationRule,
} from '../../src/lib/lexicon/nomination-rule';
import { resolveTerm, DEFAULT_CONFIG, INDUSTRY_TERMS, type ShopConfig } from '../../src/lib/shopConfig';
import { resolveSaleAttribution } from '../../src/lib/pos/attribution';
import type { PosSlip } from '../../src/lib/pos/engine';

// 用語レイヤー（Day126）。
//
// 夜職では**同じ言葉が店ごとに別の意味**を持つ。「本指名」は
//   A 店: 卓の本指名リストに入っている担当
//   B 店: 前回から続いている担当（初回は場内）
// のように数え方が違い、指名料もバックも変わる。呼び名の対応表だけ持つと
// 3 店を同じものとして集計して金銭事故になるので、概念 ID / 呼び名 / 判定規則を分ける。

describe('概念（ConceptId）', () => {
  it('夜職の実務語彙が概念として揃っている', () => {
    for (const id of ['nominationPrimary', 'nominationInhouse', 'nominationFree', 'dohan', 'extension', 'escortHome', 'closingRound', 'restart'] as const) {
      expect(ALL_CONCEPT_IDS).toContain(id);
    }
  });

  it('★すべての概念に既定の呼び名と説明がある（AI が推測で埋めない）', () => {
    for (const id of ALL_CONCEPT_IDS) {
      expect(CONCEPT_DEFAULT_TERMS[id]).toBeTruthy();
      expect(CONCEPT_DESCRIPTIONS[id]).toBeTruthy();
    }
  });

  it('未知のキーは概念として受け付けない（保存データ・AI 出力の検証用）', () => {
    expect(isConceptId('nominationPrimary')).toBe(true);
    expect(isConceptId('honshimei')).toBe(false);
    expect(isConceptId(null)).toBe(false);
  });
});

describe('呼び名の解決（店舗上書き → 業種 → 既定）', () => {
  const cfg = (terms: Record<string, string>): ShopConfig => ({ ...DEFAULT_CONFIG, terminology: terms });

  it('店舗の上書きが最優先', () => {
    expect(resolveTerm(cfg({ nominationPrimary: '本カラ' }), 'ホストクラブ', 'nominationPrimary')).toBe('本カラ');
  });

  it('業種プリセットが既定より優先される', () => {
    expect(resolveTerm(cfg({}), 'コンカフェ', 'nomination')).toBe('推し');
    expect(resolveTerm(cfg({}), 'コンカフェ', 'nominationPrimary')).toBe('本推し');
  });

  it('★「指名（総称）」と「本指名」を別概念として持つ', () => {
    // 旧実装はホストクラブで総称の nomination に「本指名」を入れていた（概念の取り違え）。
    // 総称に本指名を入れると、場内指名の客にも「本指名を選んでください」と出る。
    expect(INDUSTRY_TERMS['ホストクラブ'].nomination).toBeUndefined();
    expect(resolveTerm(cfg({}), 'ホストクラブ', 'nomination')).toBe('指名');
    expect(resolveTerm(cfg({}), 'ホストクラブ', 'nominationPrimary')).toBe('本指名');
  });

  it('未知の業種・未設定は既定へ落ちる', () => {
    expect(resolveTerm(cfg({}), '謎の業態', 'cast')).toBe('キャスト');
    expect(resolveTerm(null, undefined, 'table')).toBe('卓');
  });
});

// --- 判定規則（意味の層） ---

const RULE = (basis: NominationRule['basis'], firstVisitAs: NominationRule['firstVisitAs'] = 'inhouse'): NominationRule => ({ basis, firstVisitAs });

describe('resolveNominationKind（何をもって本指名とするか）', () => {
  it('担当が居なければ必ずフリー（店舗設定に依らない）', () => {
    for (const b of ['tableMainHost', 'customerMainCast', 'either'] as const) {
      expect(resolveNominationKind(RULE(b), { castId: null })).toBe('free');
    }
  });

  it('A 店型（卓の本指名リスト基準）＝従来挙動', () => {
    expect(resolveNominationKind(RULE('tableMainHost'), { castId: 'c1', mainHostIds: ['c1'] })).toBe('main');
    expect(resolveNominationKind(RULE('tableMainHost'), { castId: 'c1', mainHostIds: ['c2'] })).toBe('inTable');
  });

  it('★B 店型（顧客カルテの担当基準）は卓の指定に引きずられない', () => {
    // 卓では本指名扱いでも、カルテの担当が別人なら場内（＝店の運用に従う）
    expect(resolveNominationKind(RULE('customerMainCast'), {
      castId: 'c1', mainHostIds: ['c1'], customerMainCastId: 'c2', hasCustomer: true,
    })).toBe('inTable');
    expect(resolveNominationKind(RULE('customerMainCast'), {
      castId: 'c1', mainHostIds: [], customerMainCastId: 'c1', hasCustomer: true,
    })).toBe('main');
  });

  it('either はどちらかを満たせば本指名', () => {
    expect(resolveNominationKind(RULE('either'), { castId: 'c1', mainHostIds: ['c1'], customerMainCastId: 'c2', hasCustomer: true })).toBe('main');
    expect(resolveNominationKind(RULE('either'), { castId: 'c1', mainHostIds: [], customerMainCastId: 'c1', hasCustomer: true })).toBe('main');
    expect(resolveNominationKind(RULE('either'), { castId: 'c1', mainHostIds: [], customerMainCastId: 'c2', hasCustomer: true })).toBe('inTable');
  });

  it('★「継続かどうか確かめられない」を本指名と断定しない（設定に従う）', () => {
    // 顧客が伝票に紐付いていない＝カルテを引けない。ここを勝手に本指名へ倒すと売上が過大になる
    const ctx = { castId: 'c1', mainHostIds: [] as string[], hasCustomer: false };
    expect(resolveNominationKind(RULE('customerMainCast', 'inhouse'), ctx)).toBe('inTable');
    expect(resolveNominationKind(RULE('customerMainCast', 'primary'), ctx)).toBe('main');
  });

  it('カルテはあるが担当が未設定なら場内（空の担当を一致とみなさない）', () => {
    expect(resolveNominationKind(RULE('customerMainCast'), {
      castId: 'c1', customerMainCastId: null, hasCustomer: true,
    })).toBe('inTable');
  });
});

describe('normalizeNominationRule（保存値の正規化）', () => {
  it('未設定・型崩れは既定（従来の卓ベース）へ倒す', () => {
    expect(normalizeNominationRule(undefined)).toEqual(DEFAULT_NOMINATION_RULE);
    expect(normalizeNominationRule({ basis: 'とんでもない値' })).toEqual(DEFAULT_NOMINATION_RULE);
    expect(normalizeNominationRule('壊れた')).toEqual(DEFAULT_NOMINATION_RULE);
  });

  it('正しい保存値はそのまま通る', () => {
    expect(normalizeNominationRule({ basis: 'either', firstVisitAs: 'primary' })).toEqual({ basis: 'either', firstVisitAs: 'primary' });
  });
});

// --- 会計への接続（後方互換） ---

const slip = (over: Partial<PosSlip> = {}): PosSlip => ({
  id: 's1', name: '①', state: { dohan: false } as PosSlip['state'], castId: 'c1', ...over,
} as PosSlip);

describe('resolveSaleAttribution（規則の適用と後方互換）', () => {
  const casts = [{ id: 'c1', name: 'A', uid: 'u1' }, { id: 'c2', name: 'B', uid: 'u2' }];

  it('★規則を渡さなければ従来どおり卓の本指名リストで判定する（既存店の挙動を変えない）', () => {
    const r = resolveSaleAttribution({ mode: 'mainCast', operatorUid: 'op', slip: slip(), casts, mainHostIds: ['c1'] });
    expect(r.nomination).toBe('main');
    const r2 = resolveSaleAttribution({ mode: 'mainCast', operatorUid: 'op', slip: slip(), casts, mainHostIds: [] });
    expect(r2.nomination).toBe('inTable');
  });

  it('★店舗が「カルテの担当基準」を選んでいれば会計もそれに従う', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op', slip: slip({ customerId: 'cust1' }), casts,
      mainHostIds: ['c1'], nominationRule: { basis: 'customerMainCast', firstVisitAs: 'inhouse' },
      customerMainCastId: 'c2',
    });
    expect(r.nomination).toBe('inTable'); // 卓では本指名だが、カルテの担当は別人
  });

  it('担当なしはどの規則でもフリー', () => {
    const r = resolveSaleAttribution({
      mode: 'mainCast', operatorUid: 'op', slip: slip({ castId: undefined, castName: undefined }), casts,
      nominationRule: { basis: 'either', firstVisitAs: 'primary' },
    });
    expect(r.nomination).toBe('free');
  });
});
