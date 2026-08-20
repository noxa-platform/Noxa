import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreviewScenarios, previewConfig, diffPreview } from '../../src/lib/pos/preview';
import { createDefaultStoreConfig } from '../../src/lib/pos/defaultConfig';
import { calculateResult } from '../../src/lib/pos/engine';

// テスト伝票プレビュー（Day127）。
//
// 料金設定は入力欄の羅列で、保存して初めて会計に効く。間違いは翌日の会計で初めて分かる。
// AI に設定を書かせる構想があるなら、**人が承認する材料**が先に要る——
// Day115 / 123 / 124 で潰したのは全部「間違った料金設定のまま伝票が作られる」事故だった。

const cfg = () => createDefaultStoreConfig('active');

describe('buildPreviewScenarios', () => {
  it('主要な会計パターンを網羅しすぎず並べる（間違いに気づける最小セット）', () => {
    const ids = buildPreviewScenarios(cfg()).map((s) => s.id);
    // R内 / R後 は P129 で追加。AI が書ける範囲を「プレビューに金額として現れる項目」に
    // 限る設計にしたため、客層別料金の表全体を確認できる必要がある
    expect(ids).toEqual(['initial-60', 'regular-60', 'regular-90', 'regular-nomination', 'dohan-60', 'initial-90', 'regular-late-60', 'r-within-180', 'r-after-180']);
  });

  it('★客層別料金（初回 / 通常 / R内 / R後）がすべて確認できる（AI に書かせる範囲の前提・P129）', () => {
    const ids = buildPreviewScenarios(cfg()).map((s) => s.id);
    for (const need of ['initial-60', 'regular-60', 'r-within-180', 'r-after-180']) {
      expect(ids).toContain(need);
    }
  });

  it('★R内 / R後 の料金を変えると、その客層のプレビュー金額が動く（確かめる手段が実在する）', () => {
    const base = cfg();
    const raised = { ...base, rWithinPricing: { ...base.rWithinPricing, set: base.rWithinPricing.set + 5000 } };
    const ids = diffPreview(base, raised).map((d) => d.id);
    expect(ids).toContain('r-within-180');
  });

  it('各シナリオに「どの設定が効くか」の説明がある（数字だけ見せない）', () => {
    for (const s of buildPreviewScenarios(cfg())) {
      expect(s.label).toBeTruthy();
      expect(s.note).toBeTruthy();
    }
  });
});

describe('previewConfig', () => {
  it('★本番の会計と同じ計算を通す（プレビュー専用の計算を作らない）', () => {
    const c = cfg();
    const p = previewConfig(c)[1];
    const direct = calculateResult({ ...p.state, isDebugMode: true }, c);
    expect(p.result.currentTotal).toBe(direct.currentTotal);
  });

  it('★同じ設定なら何度見ても同じ金額（実時間で動かない）', () => {
    const c = cfg();
    expect(previewConfig(c).map((p) => p.result.currentTotal))
      .toEqual(previewConfig(c).map((p) => p.result.currentTotal));
  });

  it('金額と内訳が出る', () => {
    for (const p of previewConfig(cfg())) {
      expect(p.result.currentTotal).toBeGreaterThan(0);
      expect(p.result.breakdown.length).toBeGreaterThan(0);
    }
  });

  it('90分は60分より高い（延長が効いている）', () => {
    const r = previewConfig(cfg());
    const m60 = r.find((x) => x.id === 'regular-60')!.result.currentTotal;
    const m90 = r.find((x) => x.id === 'regular-90')!.result.currentTotal;
    expect(m90).toBeGreaterThan(m60);
  });
});

describe('diffPreview（保存前・AI 生成の承認材料）', () => {
  it('★「何を変えたか」ではなく「いくら変わるか」を返す', () => {
    const before = cfg();
    const after = { ...before, regularPricing: { ...before.regularPricing, earlySet: before.regularPricing.earlySet + 3000 } };
    const d = diffPreview(before, after);
    expect(d.length).toBeGreaterThan(0);
    for (const row of d) {
      expect(row.delta).toBe(row.after - row.before);
      expect(row.label).toBeTruthy();
    }
  });

  it('変えていなければ差分ゼロ（無変更を「変わった」と出さない）', () => {
    expect(diffPreview(cfg(), cfg())).toEqual([]);
  });

  it('指名料だけ変えたら指名ありのシナリオが動く', () => {
    const before = cfg();
    const after = { ...before, regularPricing: { ...before.regularPricing, nom: before.regularPricing.nom + 1000 } };
    const ids = diffPreview(before, after).map((r) => r.id);
    expect(ids).toContain('regular-nomination');
  });
});

describe('持ち越し課題: calculateWithDefault', () => {
  it('★呼び出し元ゼロの既定料金計算を残さない（Day115 から持ち越し）', () => {
    // 「config を持たない場面の保険」として残っていたが、**既定料金で伝票を作る**入口そのもの。
    // Day115 / 123 で塞いだ事故と同じ形を、いつでも再発させられる関数を置いておかない。
    const engine = readFileSync(join(process.cwd(), 'src/lib/pos/engine.ts'), 'utf-8');
    expect(engine).not.toMatch(/export function calculateWithDefault/);
  });
});
