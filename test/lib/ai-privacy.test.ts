// Day12: AI への顧客 PII 送信ガード（マスキング・allowlist）のテスト。
import { describe, it, expect } from 'vitest';
import { maskContactInfo, maskDeep, pickForAi, AI_CUSTOMER_FIELDS } from '../../src/lib/ai-privacy';

describe('maskContactInfo', () => {
  it('日本の電話番号をマスクする（ハイフン/空白/+81/連続桁）', () => {
    expect(maskContactInfo('連絡先は090-1234-5678です')).toBe('連絡先は[電話番号非表示]です');
    expect(maskContactInfo('自宅 03-1234-5678')).toBe('自宅 [電話番号非表示]');
    expect(maskContactInfo('09012345678 に電話')).toBe('[電話番号非表示] に電話');
    expect(maskContactInfo('+81 90 1234 5678')).toBe('[電話番号非表示]');
  });

  it('メールアドレスをマスクする', () => {
    expect(maskContactInfo('メモ: tanaka.taro+vip@example.co.jp 宛')).toBe('メモ: [メール非表示] 宛');
  });

  it('金額・日付・時刻・％は誤爆しない', () => {
    const s = '2026-07-07 の売上は ¥50,000。来店 21:30。ボトル残 30%。誕生日 0704。';
    expect(maskContactInfo(s)).toBe(s);
  });

  it('全角数字・全角＠・長音区切りの連絡先もマスクする（NFKC 正規化）', () => {
    expect(maskContactInfo('ケータイ０９０−１２３４−５６７８')).toBe('ケータイ[電話番号非表示]');
    expect(maskContactInfo('090ー1234ー5678 に連絡')).toBe('[電話番号非表示] に連絡');
    expect(maskContactInfo('メール ｔａｒｏ＠ｅｘａｍｐｌｅ.ｃｏｍ')).toBe('メール [メール非表示]');
  });

  it('複数の連絡先が混在しても全てマスクする', () => {
    const out = maskContactInfo('tel:080-1111-2222 mail:a@b.com 予備:070-3333-4444');
    expect(out).not.toContain('080');
    expect(out).not.toContain('a@b.com');
    expect(out).not.toContain('070-3333');
  });
});

describe('maskDeep', () => {
  it('ネストしたオブジェクト・配列の文字列を再帰的にマスクする', () => {
    const v = maskDeep({
      name: '田中様',
      memo: '電話090-1234-5678希望',
      tags: ['常連', 'メールa@b.jp'],
      nested: { note: '03-9876-5432' },
      amount: 50000,
    });
    expect(v).toEqual({
      name: '田中様',
      memo: '電話[電話番号非表示]希望',
      tags: ['常連', 'メール[メール非表示]'],
      nested: { note: '[電話番号非表示]' },
      amount: 50000,
    });
  });

  it('クラスインスタンス（Timestamp 等）は走査せずそのまま返す', () => {
    class FakeTs { toMillis() { return 1; } }
    const ts = new FakeTs();
    expect(maskDeep({ at: ts }).at).toBe(ts);
  });
});

describe('pickForAi', () => {
  it('allowlist のフィールドだけが残り、連絡先系フィールドは落ちる', () => {
    const out = pickForAi({
      name: '田中様', rank: 'S', totalSales: 100000,
      phone: '090-1234-5678', email: 'a@b.com', address: '東京都…', lineId: 'abc123',
      importantMemo: '奥様には電話080-0000-1111しない',
    }, AI_CUSTOMER_FIELDS);
    expect(out.name).toBe('田中様');
    expect(out.rank).toBe('S');
    expect(out).not.toHaveProperty('phone');
    expect(out).not.toHaveProperty('email');
    expect(out).not.toHaveProperty('address');
    expect(out).not.toHaveProperty('lineId');
    expect(out.importantMemo).toBe('奥様には電話[電話番号非表示]しない'); // メモ内の連絡先もマスク
  });

  it('null/undefined/空文字は含めない・data 無しは空オブジェクト', () => {
    expect(pickForAi({ name: '', rank: null, tags: undefined }, AI_CUSTOMER_FIELDS)).toEqual({});
    expect(pickForAi(undefined, AI_CUSTOMER_FIELDS)).toEqual({});
  });
});
