import { describe, it, expect } from 'vitest';
import { checkNg } from '../../src/lib/community/ng-words';

describe('checkNg', () => {
  it('通常テキストは hard/soft ともに空', () => {
    const r = checkNg('今日は指名がたくさん入って嬉しい');
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });

  it('重大語（援交）は hard で検出＝投稿不可', () => {
    const r = checkNg('援交の相手を探してる');
    expect(r.hard).toContain('援交');
  });

  it('改正風営法ワード（No.1）は soft のみ＝警告で続行可', () => {
    const r = checkNg('私はこの店のNo.1です');
    expect(r.soft).toContain('no.1');
    expect(r.hard).toEqual([]);
  });

  it('半角の連絡先（電話/メール/URL）は hard で検出', () => {
    expect(checkNg('090-1234-5678 に連絡して').hard).toContain('電話番号');
    expect(checkNg('abc@example.com まで').hard).toContain('メールアドレス');
    expect(checkNg('詳しくは https://example.com/x で').hard).toContain('URL');
  });

  // ─ 回帰: 全角入力によるモデレーション回避を塞ぐ（NFKC 正規化）─
  it('全角の電話番号も検出する（回避バグの回帰）', () => {
    // 全角数字＋全角ハイフン。正規化前は \d が半角のみで素通りしていた
    const r = checkNg('連絡先は ０９０－１２３４－５６７８ だよ');
    expect(r.hard).toContain('電話番号');
  });

  it('全角のメールアドレスも検出する', () => {
    const r = checkNg('ａｂｃ＠ｅｘ．ｃｏｍ に送って');
    expect(r.hard).toContain('メールアドレス');
  });

  it('全角の「ＬＩＮＥ交換」も重大語として検出する', () => {
    const r = checkNg('よかったらＬＩＮＥ交換しよ');
    expect(r.hard).toContain('line交換');
  });

  it('大文字/全角混在でも小文字ワードに一致（LINE ID）', () => {
    expect(checkNg('LINE ID おしえて').hard).toContain('line id');
  });
});
