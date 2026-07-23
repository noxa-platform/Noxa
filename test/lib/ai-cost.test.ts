import { describe, expect, it } from 'vitest';
import { computeChatCost, estimateAiCost, describeAiCost } from '../../src/lib/ai-cost';

// AI チャットのクレジット計算——クライアント表示とサーバー reserve の両方が従う（Day26）

describe('computeChatCost', () => {
  it('通常メッセージは 1 クレジット（空文字も最低1）', () => {
    expect(computeChatCost('こんにちは')).toBe(1);
    expect(computeChatCost('')).toBe(1);
  });
  it('2000文字ごとに 1 クレジット加算（境界: 2000=1 / 2001=2）', () => {
    expect(computeChatCost('a'.repeat(2000))).toBe(1);
    expect(computeChatCost('a'.repeat(2001))).toBe(2);
    expect(computeChatCost('a'.repeat(4000))).toBe(2);
    expect(computeChatCost('a'.repeat(4001))).toBe(3);
  });
  it('画像は 1 枚 +2 クレジット', () => {
    expect(computeChatCost('hi', 1)).toBe(3);
    expect(computeChatCost('hi', 3)).toBe(7);
  });
  it('think モードは 3 倍（切り上げ・最低1）', () => {
    expect(computeChatCost('hi', 0, 'think')).toBe(3);
    expect(computeChatCost('a'.repeat(2001), 1, 'think')).toBe(12); // (2+2)*3
    expect(computeChatCost('', 0, 'fast')).toBe(1);
  });
});

// estimateAiCost（v2）: チャット以外の 15 の AI ルートが課金引当（reserveAiCredit）に使う
// money パス。挙動を characterization で固定し、将来の式ドリフトを検知する（Day64）。
describe('estimateAiCost', () => {
  it('入力テキストは 2000 字ごとに 1cr（境界: 2000=1 / 2001=2）、最低 base 1cr', () => {
    expect(estimateAiCost({ inputText: 'short' })).toBe(1);
    expect(estimateAiCost({ inputText: 'a'.repeat(2000) })).toBe(1);
    expect(estimateAiCost({ inputText: 'a'.repeat(2001) })).toBe(2);
  });

  it('入力が空文字なら base を立てない（画像のみケースの二重課金回避）', () => {
    // 空 + 画像なし → 最終 max(1,...) で 1cr だが、内訳 input は 0
    expect(estimateAiCost({ inputText: '' })).toBe(1);
    expect(describeAiCost({ inputText: '' }).breakdown.input).toBe(0);
    // 画像のみ（input=0）: base を足さないので 画像 2 枚 = 4cr ちょうど
    expect(estimateAiCost({ inputText: '', imageCount: 2 })).toBe(4);
    expect(describeAiCost({ inputText: '', imageCount: 2 }).breakdown.input).toBe(0);
  });

  it('画像は 1 枚 +2cr', () => {
    expect(estimateAiCost({ inputText: 'x', imageCount: 1 })).toBe(3); // 1 + 2
    expect(estimateAiCost({ inputText: 'x', imageCount: 3 })).toBe(7); // 1 + 6
  });

  it('想定出力トークンは 1000 で +0.5cr → 切り上げで 1cr（3000 で +2cr）', () => {
    expect(estimateAiCost({ inputText: 'x', expectedOutputTokens: 1000 })).toBe(2); // 1 + ceil(0.5)
    expect(estimateAiCost({ inputText: 'x', expectedOutputTokens: 3000 })).toBe(3); // 1 + ceil(1.5)
  });

  it('think モードは全体 ×3、featureMultiplier は式全体に乗る', () => {
    expect(estimateAiCost({ inputText: 'a'.repeat(4000), thinkMode: true })).toBe(6); // 2 ×3
    expect(estimateAiCost({ inputText: 'a'.repeat(4000), featureMultiplier: 1.5 })).toBe(3); // ceil(2 ×1.5)
  });

  it('featureMultiplier < 1 は割引として効く（parse ルート相当）', () => {
    // parse: input 1 + output ceil(200/1000*0.5)=1 → (1+1)*0.5 = 1cr、maxCap 2
    expect(estimateAiCost({ inputText: 'x', expectedOutputTokens: 200, featureMultiplier: 0.5, maxCap: 2 })).toBe(1);
  });

  it('既定の暴走ガードは 30cr、maxCap:Infinity で上限解除（learn-from-text 相当）', () => {
    // 100000 字 = input 50cr。×3(think)×1.5 = 225 → 既定 cap 30
    expect(estimateAiCost({ inputText: 'a'.repeat(100000), thinkMode: true, featureMultiplier: 1.5 })).toBe(30);
    // maxCap 解除なら 50 ×1.2 = 60cr がそのまま
    expect(
      estimateAiCost({ inputText: 'a'.repeat(100000), featureMultiplier: 1.2, maxCap: Number.POSITIVE_INFINITY }),
    ).toBe(60);
  });

  it('不正入力は安全側にフォールバック（負/NaN の画像・非正の倍率は無効化）', () => {
    expect(estimateAiCost({ inputText: 'x', imageCount: -5 })).toBe(1); // 負は 0 にクランプ
    expect(estimateAiCost({ inputText: 'x', imageCount: Number.NaN })).toBe(1); // NaN は 0
    expect(estimateAiCost({ inputText: 'x', featureMultiplier: 0 })).toBe(1); // 0 は 1 扱い
    expect(estimateAiCost({ inputText: 'x', featureMultiplier: -3 })).toBe(1); // 負は 1 扱い
  });

  it('describeAiCost.total は estimateAiCost と常に一致する', () => {
    const inputs = [
      { inputText: 'x' },
      { inputText: 'a'.repeat(5000), imageCount: 2, expectedOutputTokens: 1500, thinkMode: true, featureMultiplier: 1.5 },
      { inputText: '', imageCount: 3, expectedOutputTokens: 800, featureMultiplier: 0.5, maxCap: 3 },
    ];
    for (const inp of inputs) {
      expect(describeAiCost(inp).total).toBe(estimateAiCost(inp));
    }
  });

  it('cap 未達なら total = ceil((input+image+output) × think × feature)（内訳と整合）', () => {
    const inp = { inputText: 'a'.repeat(5000), imageCount: 2, expectedOutputTokens: 3000, featureMultiplier: 1.2 };
    const { total, breakdown } = describeAiCost(inp);
    const expected = Math.ceil(
      (breakdown.input + breakdown.image + breakdown.output) * breakdown.thinkMultiplier * breakdown.featureMultiplier,
    );
    expect(total).toBe(expected);
  });
});
