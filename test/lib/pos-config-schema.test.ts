import { describe, it, expect } from 'vitest';
import { validateConfigPatch, WRITABLE_FIELDS, describeField } from '../../src/lib/pos/config-schema';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';
import { buildPreviewScenarios, diffPreview } from '../../src/lib/pos/preview';
import type { StoreConfig } from '../../src/lib/pos/types';

// AI が提案した料金設定の検証（P129）。
//
// これは便利関数ではなく「AI が Config を書く」機能の入口の栓。料金設定は伝票の
// 金額に直結し（Day115 / 123 / 124 の事故は全部この形）、人は「AI がそう言っている」
// という理由で承認してしまう。型・範囲・対象外を通すと、その承認が空手形になる。

const cfg = (): StoreConfig => createDefaultStoreConfig('active', 'テスト店');

describe('validateConfigPatch（AI 出力の検証）', () => {
  it('★要望どおりの項目だけをパッチにする（言及されなかった項目を触らない）', () => {
    const c = cfg();
    const r = validateConfigPatch({ initialPricing: { set: 3000 } }, c);
    expect(r.patch.initialPricing).toEqual({ ...c.initialPricing, set: 3000 });
    expect(r.accepted).toEqual(['initialPricing.set']);
    // 通常料金など他のグループには一切触れない
    expect(r.patch.regularPricing).toBeUndefined();
    expect(r.patch.taxRate).toBeUndefined();
  });

  it('★グループの一部だけ指定されても、他の項目は現行値を保つ（既定値で消さない）', () => {
    const c = cfg();
    const r = validateConfigPatch({ regularPricing: { ext: 4000 } }, c);
    expect(r.patch.regularPricing).toEqual({ ...c.regularPricing, ext: 4000 });
    expect(r.patch.regularPricing?.earlySet).toBe(c.regularPricing.earlySet);
    expect(r.patch.regularPricing?.thresholdHour).toBe(c.regularPricing.thresholdHour);
  });

  it('★現行と同じ値は「変更」に数えない（金額が動かないのに N 項目変更と出さない）', () => {
    const c = cfg();
    const r = validateConfigPatch({ dohanFee: c.dohanFee, additionalNominationFee: 7000 }, c);
    expect(r.accepted).toEqual(['additionalNominationFee']);
    expect(r.patch.dohanFee).toBeUndefined();
  });

  it('★範囲外・型違いは捨てて、理由を残す（黙って落とさない）', () => {
    const c = cfg();
    const r = validateConfigPatch({
      dohanFee: -1,              // 負の金額
      taxRate: 10,               // 率なのに % で来た
      closingHour: 99,           // 時刻の範囲外
      additionalNominationFee: '3000', // 文字列
      initialPricing: { set: 1.5 },    // 小数の金額
    }, c);
    expect(r.accepted).toEqual([]);
    expect(r.patch).toEqual({});
    expect(r.rejected.map((x) => x.path).sort()).toEqual(
      ['additionalNominationFee', 'closingHour', 'dohanFee', 'initialPricing.set', 'taxRate'],
    );
    for (const x of r.rejected) expect(x.reason).toBeTruthy();
  });

  it('★上限を超える金額は弾く（桁の打ち間違い・モデルの暴走を通さない）', () => {
    const c = cfg();
    const r = validateConfigPatch({ dohanFee: 5_000_000 }, c);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].path).toBe('dohanFee');
  });

  it('★対象外の項目は「AI では変更できない」として捨てる（メニュー・卓名・半額ルール）', () => {
    const c = cfg();
    const r = validateConfigPatch({
      menuItems: [{ name: '勝手に追加', price: 99999 }],
      tableNames: ['Z'],
      halfOffRules: { canSpecialPrice: 1 },
      storeName: '別の店',
    }, c);
    expect(r.patch).toEqual({});
    expect(r.rejected.map((x) => x.path).sort()).toEqual(['halfOffRules', 'menuItems', 'storeName', 'tableNames']);
    for (const x of r.rejected) expect(x.reason).toMatch(/変更できません/);
  });

  it('★グループ内の未知キーも捨てる（set/ext/nom/tc 以外）', () => {
    const c = cfg();
    const r = validateConfigPatch({ initialPricing: { set: 3000, mystery: 1 } }, c);
    expect(r.accepted).toEqual(['initialPricing.set']);
    expect(r.rejected.map((x) => x.path)).toEqual(['initialPricing.mystery']);
  });

  it('★オブジェクトでない出力は全体を却下（配列・文字列・null）', () => {
    const c = cfg();
    for (const bad of [null, 'こんにちは', [1, 2, 3], 42]) {
      const r = validateConfigPatch(bad, c);
      expect(r.accepted).toEqual([]);
      expect(r.rejected).toHaveLength(1);
    }
  });

  it('グループの中身がオブジェクトでなければグループごと却下', () => {
    const c = cfg();
    const r = validateConfigPatch({ regularPricing: 5000, initialPricing: 'たかい' }, c);
    expect(r.patch).toEqual({});
    expect(r.rejected.map((x) => x.path).sort()).toEqual(['initialPricing', 'regularPricing']);
  });

  it('率は小数で受ける（0.1 = 10%）', () => {
    const c = cfg();
    const r = validateConfigPatch({ taxRate: 0.15 }, c);
    expect(r.patch.taxRate).toBe(0.15);
  });

  it('★閉店時刻は AI の対象外（合計金額が動かない＝承認する材料が出ない）', () => {
    const c = cfg();
    const r = validateConfigPatch({ closingHour: 26 }, c);
    expect(r.patch).toEqual({});
    expect(r.rejected.map((x) => x.path)).toEqual(['closingHour']);
  });
});

// ── 設計上の制約: 書ける項目は「プレビューで金額を確かめられるもの」だけ ──
//
// 確かめる手段の無い数字を AI に書かせると、承認フローの見た目だけ作って中身が空になる。
// この対応が崩れていないかを機械的に確かめる。
describe('★AI が書ける項目は、テスト伝票プレビューで金額が動くものに限る', () => {
  const c = cfg();

  /** そのパスの値をいじった config を作る */
  function bump(path: string): StoreConfig {
    const next = JSON.parse(JSON.stringify(c)) as StoreConfig;
    const [head, tail] = path.split('.');
    const target = (tail ? (next as unknown as Record<string, Record<string, number>>)[head] : (next as unknown as Record<string, number>));
    const key = tail ?? head;
    const cur = (target as Record<string, number>)[key];
    // 率は小さく、時刻は 1 時間、金額は 5000 円ずらす
    // 時刻は境界をまたぐ幅で振る（早/遅の判定は ±1 時間では動かないことがある＝
    // 「動かせない」ではなく「probe が弱い」だけなので、確かめ方の側を強くする）
    const delta = path.includes('taxRate') || path.includes('TaxRate') ? 0.1 : (key.toLowerCase().includes('hour') ? 3 : 5000);
    (target as Record<string, number>)[key] = cur + delta;
    return next;
  }

  it.each(WRITABLE_FIELDS)('%s を変えるとプレビューの金額が動く', (path) => {
    const changed = bump(path);
    expect(diffPreview(c, changed).length).toBeGreaterThan(0);
  });

  it('プレビューのシナリオが存在する（この対応表の前提）', () => {
    expect(buildPreviewScenarios(c).length).toBeGreaterThanOrEqual(9);
  });
});

describe('describeField（現場の言葉に直す）', () => {
  it('グループと項目を日本語で返す', () => {
    expect(describeField('initialPricing.set')).toBe('初回料金・セット');
    expect(describeField('regularPricing.thresholdHour')).toBe('通常料金・早/遅の境界時刻');
    expect(describeField('dohanFee')).toBe('同伴料');
  });

  it('未知のパスでも落ちない（そのまま返す）', () => {
    expect(describeField('unknownThing')).toBe('unknownThing');
  });
});
