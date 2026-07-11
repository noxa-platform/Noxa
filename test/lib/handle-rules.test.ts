import { describe, expect, it } from 'vitest';
import { suggestHandle, validateHandle } from '../../src/lib/handle-rules';

// ハンドル（/u/<handle> の URL キー）の検証・候補生成（Day25）

describe('validateHandle', () => {
  it('正規化（trim・小文字化）して返す', () => {
    expect(validateHandle('  Tanaka_01 ')).toBe('tanaka_01');
  });
  it('3〜20文字の英数字と _ のみ許可', () => {
    expect(validateHandle('ab')).toBeNull();               // 短すぎ
    expect(validateHandle('a'.repeat(21))).toBeNull();     // 長すぎ
    expect(validateHandle('a'.repeat(20))).toBe('a'.repeat(20));
    expect(validateHandle('たなか')).toBeNull();            // 日本語
    expect(validateHandle('ta-naka')).toBeNull();          // ハイフン不可
    expect(validateHandle('')).toBeNull();
  });
  it('予約語は拒否', () => {
    expect(validateHandle('admin')).toBeNull();
    expect(validateHandle('NOXA')).toBeNull(); // 大文字でも正規化後に拒否
    expect(validateHandle('u')).toBeNull();
  });
});

describe('suggestHandle', () => {
  it('英数字以外を除去して小文字化', () => {
    expect(suggestHandle('Tanaka Taro')).toBe('tanakataro');
  });
  it('短い/日本語のみの seed は noxa_ プレフィックスで補う', () => {
    expect(suggestHandle('田中')).toBe('noxa_');
    expect(suggestHandle('ab')).toBe('noxa_ab');
  });
  it('20文字に切り詰める', () => {
    expect(suggestHandle('a'.repeat(30))).toBe('a'.repeat(20));
  });
  it('予約語になってしまう場合は回避する（onboarding 初期表示で即エラーにしない）', () => {
    expect(suggestHandle('Admin')).toBe('admin_');
    expect(suggestHandle('NOXA')).toBe('noxa_');
    expect(validateHandle(suggestHandle('Admin'))).not.toBeNull();
  });
  it('生成結果は常に validateHandle を通る', () => {
    for (const seed of ['Admin', '田中', 'a', 'Tanaka Taro', 'x'.repeat(40), 'support', '']) {
      const s = suggestHandle(seed);
      expect(validateHandle(s), `seed=${seed} -> ${s}`).toBe(s);
    }
  });
});
