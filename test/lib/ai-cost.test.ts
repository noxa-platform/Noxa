import { describe, expect, it } from 'vitest';
import { computeChatCost } from '../../src/lib/ai-cost';

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
