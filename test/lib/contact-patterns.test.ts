import { describe, it, expect } from 'vitest';
import { PHONE_SEP_CLASS } from '../../src/lib/contact-patterns';

// 電話区切りの共通文字クラス（3経路で単一ソース化）の回帰。
// この集合に区切りを足すだけで ai-privacy / pii-sanitizer / ng-words の全経路に効くこと、
// および「毎回ズレていた」区切り（長音・各種ダッシュ・ドット・中黒・アンダースコア）を
// 取りこぼさないことを固定する。

describe('PHONE_SEP_CLASS', () => {
  const re = new RegExp(`^0${PHONE_SEP_CLASS}0$`); // 「0<区切り>0」で1文字の区切りにマッチ

  it('必須の区切り文字を全て含む（漏れが繰り返した集合）', () => {
    for (const sep of ['-', ' ', '.', '・', '_', 'ー', '−', '‐', '―']) {
      expect(re.test(`0${sep}0`)).toBe(true);
    }
  });

  it('数字は区切りとして扱わない（誤マッチ防止）', () => {
    expect(re.test('010')).toBe(false); // 間が数字 → 区切りではない
  });

  it('タブ・改行など空白も \\s で含む', () => {
    expect(re.test('0\t0')).toBe(true);
  });
});
