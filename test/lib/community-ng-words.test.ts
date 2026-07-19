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

  it('大文字/全角混在でも LINE ID の提示は hard で検出', () => {
    // Day43: 単純部分一致の重大語 'line id' から語境界を見るパターン 'LINE ID' へ移設。
    // ブロックされる挙動は不変（ラベルのみ変更）。
    expect(checkNg('LINE ID おしえて').hard).toContain('LINE ID');
    expect(checkNg('ＬＩＮＥ　ＩＤ おしえて').hard).toContain('LINE ID');
    expect(checkNg('line@abc123 まで').hard).toContain('LINE ID');
  });

  // ─ Day43: 誤ブロック（偽陽性）の回帰 ─
  it('「online identity」等の無関係語を LINE ID として誤ブロックしない', () => {
    // 旧実装は重大語 'line id' の部分一致で "onLINE IDentity" にヒットし、
    // 無関係な投稿まで hard（投稿不可）になっていた。
    expect(checkNg('online identity について考える').hard).toEqual([]);
    expect(checkNg('online ideaを共有したい').hard).toEqual([]);
  });

  it('日付・金額・時刻を電話番号として誤検出しない', () => {
    // 区切り文字に . を許容した副作用チェック
    expect(checkNg('2026.07.17 に出勤').hard).toEqual([]);
    expect(checkNg('料金は0円です').hard).toEqual([]);
    expect(checkNg('今日は20:00から').hard).toEqual([]);
  });

  // ─ Day43: 連絡先交換の回避を塞ぐ ─
  it('区切り文字を変えた電話番号（. ・ _ 空白）も検出する', () => {
    // 旧実装は区切りが「-‐ 半角空白」のみで、これらは素通りしていた
    expect(checkNg('090.1234.5678').hard).toContain('電話番号');
    expect(checkNg('090・1234・5678').hard).toContain('電話番号');
    expect(checkNg('090_1234_5678').hard).toContain('電話番号');
    expect(checkNg('090 1234 5678').hard).toContain('電話番号');
  });

  it('国際表記（+81）の電話番号も検出する', () => {
    expect(checkNg('+81 90 1234 5678 に連絡ちょうだい').hard).toContain('電話番号');
    expect(checkNg('+81-90-1234-5678').hard).toContain('電話番号');
  });

  // ─ Day51 回帰: 長音「ー」・マイナス「−」・全角ダッシュ「―」区切りの電話も検出する ─
  // 旧 PHONE_SEP は '[-‐.・_ ]' で ー(U+30FC)/−(U+2212)/―(U+2015) を含まず素通りしていた
  // （NFKC でも '-' にならない）。共通 PHONE_SEP_CLASS へ集約して塞いだ。
  it('長音・マイナス・全角ダッシュ区切りの電話番号も検出する', () => {
    expect(checkNg('090ー1234ー5678').hard).toContain('電話番号');
    expect(checkNg('090−1234−5678').hard).toContain('電話番号');
    expect(checkNg('090―1234―5678').hard).toContain('電話番号');
  });

  it('スキーム無しのメッセンジャー/SNS リンクも検出する', () => {
    // https:// が無いため URL パターンを素通りしていた経路
    expect(checkNg('line.me/ti/p/xxxx で追加して').hard).toContain('連絡先リンク');
    expect(checkNg('t.me/foo きて').hard).toContain('連絡先リンク');
    expect(checkNg('open.kakao.com/o/abc').hard).toContain('連絡先リンク');
    expect(checkNg('instagram.com/someone').hard).toContain('連絡先リンク');
  });

  it('ドメイン風の語の途中は連絡先リンクとして誤検出しない', () => {
    expect(checkNg('online.me という架空の話').hard).toEqual([]);
  });

  it('ひらがなの「らいん交換」も検出する', () => {
    expect(checkNg('よかったららいん交換しよ').hard).toContain('らいん交換');
  });
});
