import { describe, expect, it } from 'vitest';
import { suggestHandle, validateHandle, planHandleChange } from '../../src/lib/handle-rules';

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

describe('planHandleChange', () => {
  it('new が不正/予約語なら null', () => {
    expect(planHandleChange('taro', 'ab')).toBeNull();       // 短すぎ
    expect(planHandleChange('taro', 'admin')).toBeNull();    // 予約語
    expect(planHandleChange('taro', 'た なか')).toBeNull();   // 不正文字
  });
  it('new を正規化して返す', () => {
    expect(planHandleChange('taro', '  Jiro_02 ')).toEqual({ oldH: 'taro', newH: 'jiro_02', noop: false });
  });
  it('old も正規化してから比較する（大文字・空白の差は noop 扱い）', () => {
    // doc パスは case-sensitive。未正規化の old を渡しても正規化後の同一性で noop 判定する
    expect(planHandleChange('Taro', 'taro')).toEqual({ oldH: 'taro', newH: 'taro', noop: true });
    expect(planHandleChange('  TARO ', 'taro')).toEqual({ oldH: 'taro', newH: 'taro', noop: true });
  });
  it('old を正規化して参照キーに使える（誤 doc パス＝データ損失を防ぐ）', () => {
    // 変更前は old が未正規化のまま profile_pages/{old} を指し、Mixed-case で誤 doc を読んでいた
    const plan = planHandleChange('MyHandle', 'newhandle');
    expect(plan).toEqual({ oldH: 'myhandle', newH: 'newhandle', noop: false });
  });
  it('old が空でも new が妥当なら変更プランを返す', () => {
    expect(planHandleChange('', 'taro')).toEqual({ oldH: '', newH: 'taro', noop: false });
  });
});
