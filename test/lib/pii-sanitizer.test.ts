import { describe, it, expect } from 'vitest';
import { sanitizePii, extractStructuralFeatures } from '../../src/lib/ai-knowledge/pii-sanitizer';

// AI 匿名化学習集合へ渡す前の PII 伏字化（sanitizePii）の回帰。
// この関数を素通りした個人/店舗情報は学習集合に残るため、漏れは実害（プライバシー）。

describe('sanitizePii — 基本の伏字化', () => {
  it('電話・メール・URL・SNS ID を伏字化', () => {
    expect(sanitizePii('090-1234-5678')).toBe('[PHONE]');
    expect(sanitizePii('09012345678')).toBe('[PHONE]');
    expect(sanitizePii('abc@example.com')).toBe('[EMAIL]');
    expect(sanitizePii('https://example.com/x')).toBe('[URL]');
    expect(sanitizePii('@tanaka_love')).toBe('[SOCIAL_ID]');
  });

  it('金額・日付・時刻・地名を伏字化', () => {
    expect(sanitizePii('3万円')).toBe('[MONEY]');
    expect(sanitizePii('5/12')).toBe('[DATE]');
    expect(sanitizePii('21:30')).toBe('[TIME]');
    expect(sanitizePii('新宿駅')).toBe('[PLACE]');
  });

  it('接尾辞つき氏名・店舗名を伏字化', () => {
    expect(sanitizePii('田中さん')).toBe('[NAME]さん');
    expect(sanitizePii('ミラージュ店')).toBe('[STORE]');
  });

  it('空文字は空文字を返す', () => {
    expect(sanitizePii('')).toBe('');
  });
});

// ─ Day44 回帰: 長音符「ー」を含むカタカナ名の部分漏れ ─
// カタカナ範囲 ァ-ヶ は長音符(U+30FC)を含まないため、"ー" の手前で正規表現が途切れ、
// 店名/氏名/地名の一部が伏字化されず漏れていた。
describe('sanitizePii — 長音符カタカナの部分漏れ（回帰）', () => {
  it('長音符を含むカタカナ氏名が完全に伏字化される', () => {
    // 修正前は "アリーさん" が丸ごと素通りしていた（アリー に ー が含まれるため）
    expect(sanitizePii('アリーさんが来た')).toBe('[NAME]さんが来た');
    expect(sanitizePii('ルナールさんと話した')).toBe('[NAME]さんと話した');
    expect(sanitizePii('マリーちゃん')).toBe('[NAME]さん');
  });

  it('長音符を含むカタカナ店名が完全に伏字化される', () => {
    // 修正前は "ミラージュ店" が "ミラー[STORE]" と部分漏れしていた
    expect(sanitizePii('ミラージュ店')).toBe('[STORE]');
    expect(sanitizePii('ハーバーラウンジ')).toBe('[STORE]');
  });

  it('長音符を含むカタカナ地名が完全に伏字化される', () => {
    // 修正前は "レーヴ市" が "レー[PLACE]" と部分漏れしていた
    expect(sanitizePii('レーヴ市')).toBe('[PLACE]');
  });

  it('一般的なカタカナ語は過剰伏字化しない（接尾辞なし）', () => {
    // 長音符を含めたことで一般語まで [STORE]/[NAME] 化しないことを固定
    expect(sanitizePii('スーパーで買い物')).toBe('スーパーで買い物');
    expect(sanitizePii('コーヒーを頼んだ')).toBe('コーヒーを頼んだ');
    expect(sanitizePii('テーブルを片付ける')).toBe('テーブルを片付ける');
    expect(sanitizePii('お客さんが喜んだ')).toBe('お客さんが喜んだ');
  });
});

describe('extractStructuralFeatures — 構造特徴のみ抽出（原文非保存）', () => {
  it('文数・感嘆・疑問・末尾疑問を拾う', () => {
    const f = extractStructuralFeatures('また会いたいな！今度いつ空いてる？');
    expect(f.exclamationCount).toBe(1);
    expect(f.hasQuestion).toBe(true);
    expect(f.endsWithQuestion).toBe(true);
    expect(f.sentenceCount).toBe(2);
  });

  it('感謝・謝罪・未来参照を検出', () => {
    const f = extractStructuralFeatures('この前はありがとう。また今度ね');
    expect(f.hasAppreciation).toBe(true);
    expect(f.hasFutureReference).toBe(true);
  });

  it('空文字でも例外を投げず 0 を返す', () => {
    const f = extractStructuralFeatures('');
    expect(f.length).toBe(0);
    expect(f.sentenceCount).toBe(0);
    expect(f.sentenceAvgLength).toBe(0);
    expect(f.emojiLevel).toBe('none');
  });
});
