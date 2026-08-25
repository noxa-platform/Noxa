import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// P153: 「どのモデルを実際に呼ぶか」を決める場所の挙動を固定する。
//
// ここが曖昧だったせいで起きていたこと:
//   - chat/route.ts が override の有無で実装 2 本に分岐し、片方は**到達しない死んだ実装**だった
//   - SSE meta のモデル名が 'gemini-2.5-flash' 固定＝実際に呼んだモデルと無関係だった
//   - ModelTier の 'lite' が**黙って** FAST に落ちていた（安いつもりが FAST の値段）
//   - 単価表に無いモデルのコストが 0 として並んでいた（「タダで動いた」と読める）

vi.mock('../../src/app/api/lib/ai-kill-switch', () => ({ assertAiEnabled: vi.fn() }));
vi.mock('../../src/app/api/ai/openrouter', () => ({
  generateOpenRouterText: vi.fn(),
  generateOpenRouterStream: vi.fn(),
}));

import { resolveChatModel } from '../../src/app/api/ai/ai-provider';
import { findModelMeta, estimateUsdCost, OPENROUTER_MODELS } from '../../src/lib/ai-models';
import { COST_BASIS, referenceRequestCostJpy, hasCostReferenceModel } from '../../src/lib/ai-cost';

const saved = { ...process.env };

describe('resolveChatModel（実際に呼ぶモデルの決定）', () => {
  beforeEach(() => {
    delete process.env.AI_PRIMARY_MODEL_FAST;
    delete process.env.AI_PRIMARY_MODEL_THINK;
    delete process.env.AI_PRIMARY_MODEL_LITE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('override があれば env より優先する（運営者指定）', () => {
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:a/fast';
    expect(resolveChatModel({ modelTier: 'flash', override: 'b/override' })).toBe('b/override');
  });

  it('override が空文字・空白だけなら無視して env を使う', () => {
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:a/fast';
    expect(resolveChatModel({ modelTier: 'flash', override: '   ' })).toBe('a/fast');
    expect(resolveChatModel({ modelTier: 'flash', override: null })).toBe('a/fast');
  });

  it('tier ごとに対応する env を引く', () => {
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:a/fast';
    process.env.AI_PRIMARY_MODEL_THINK = 'openrouter:a/think';
    process.env.AI_PRIMARY_MODEL_LITE = 'openrouter:a/lite';
    expect(resolveChatModel({ modelTier: 'flash' })).toBe('a/fast');
    expect(resolveChatModel({ modelTier: 'pro' })).toBe('a/think');
    expect(resolveChatModel({ modelTier: 'lite' })).toBe('a/lite');
    // tier 未指定は FAST 扱い
    expect(resolveChatModel({})).toBe('a/fast');
  });

  it('lite は LITE 未設定なら FAST を使うが、**黙らずに** 1 回だけ知らせる', () => {
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:a/fast';
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(resolveChatModel({ modelTier: 'lite' })).toBe('a/fast');
      expect(resolveChatModel({ modelTier: 'lite' })).toBe('a/fast');
      // 2 回目はログを出さない（リクエストごとに出すとログが埋まる）
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0][0])).toContain('AI_PRIMARY_MODEL_LITE');
    } finally {
      info.mockRestore();
    }
  });

  it('未設定・形式違いは throw する（勝手なフォールバック先を持たない）', () => {
    expect(() => resolveChatModel({ modelTier: 'flash' })).toThrow(/AI_PRIMARY_MODEL_FAST/);
    process.env.AI_PRIMARY_MODEL_THINK = 'google/gemini-2.5-pro'; // "openrouter:" が無い
    expect(() => resolveChatModel({ modelTier: 'pro' })).toThrow(/AI_PRIMARY_MODEL_THINK/);
    process.env.AI_PRIMARY_MODEL_FAST = 'openrouter:   ';
    expect(() => resolveChatModel({ modelTier: 'flash' })).toThrow(/AI_PRIMARY_MODEL_FAST/);
  });

  it('lite も FAST すら無ければ throw（LITE の名前でエラーを出す）', () => {
    expect(() => resolveChatModel({ modelTier: 'lite' })).toThrow(/AI_PRIMARY_MODEL_LITE/);
  });
});

describe('モデル単価表（src/lib/ai-models.ts）', () => {
  it('モデル ID は重複しない（同じ id が 2 行あると単価がどちらか不定になる）', () => {
    const ids = OPENROUTER_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('単価は全行で有限かつ 0 より大きい（0 は「タダ」という意味のある値）', () => {
    for (const m of OPENROUTER_MODELS) {
      expect(Number.isFinite(m.inputCostUsdPerM) && m.inputCostUsdPerM > 0).toBe(true);
      expect(Number.isFinite(m.outputCostUsdPerM) && m.outputCostUsdPerM > 0).toBe(true);
    }
  });

  it('表にあるモデルは input/output を按分して合算する', () => {
    const meta = OPENROUTER_MODELS[0];
    const cost = estimateUsdCost(meta.id, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).not.toBeNull();
    expect(cost!.inputUsd).toBeCloseTo(meta.inputCostUsdPerM, 10);
    expect(cost!.outputUsd).toBeCloseTo(meta.outputCostUsdPerM, 10);
    expect(cost!.totalUsd).toBeCloseTo(meta.inputCostUsdPerM + meta.outputCostUsdPerM, 10);
  });

  it('表に無いモデルは **null**（0 に倒すと比較表で最安として並ぶ）', () => {
    expect(findModelMeta('who/knows')).toBeUndefined();
    expect(estimateUsdCost('who/knows', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });

  it('壊れた usage（NaN / 負数）は 0 トークン扱いにするが、料金自体は null にしない', () => {
    const cost = estimateUsdCost(OPENROUTER_MODELS[0].id, { inputTokens: NaN, outputTokens: -5 });
    expect(cost).toEqual({ inputUsd: 0, outputUsd: 0, totalUsd: 0 });
  });
});

describe('コスト前提（COST_BASIS）', () => {
  it('基準モデルが表に実在する（コメントの数字が独り歩きしていない）', () => {
    expect(hasCostReferenceModel()).toBe(true);
    expect(findModelMeta(COST_BASIS.referenceModelId)).toBeDefined();
  });

  it('概算原価は表から導かれる（直書きの数字ではない）', () => {
    const meta = findModelMeta(COST_BASIS.referenceModelId)!;
    const expected =
      ((COST_BASIS.assumedInputTokens / 1_000_000) * meta.inputCostUsdPerM +
        (COST_BASIS.assumedOutputTokens / 1_000_000) * meta.outputCostUsdPerM) *
      COST_BASIS.jpyPerUsd;
    expect(referenceRequestCostJpy()).toBeCloseTo(expected, 10);
  });
});
