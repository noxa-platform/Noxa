import { describe, it, expect } from 'vitest';
import {
  buildSelfBaseBlock,
  buildStoreProfileBlock,
  composePlaybookAndSelf,
  STRICT_RULES_BLOCK,
} from '../../src/lib/ai-knowledge/prompt-helpers';

// AI system プロンプトへ差し込むプロファイル/店舗ブロック生成の characterization。
// 空データで無駄なブロックを出さないこと・一人称の絶対遵守がプロファイルより上位に来ることを固定。

describe('buildSelfBaseBlock', () => {
  it('null・空データは空文字（プロンプトを汚さない）', () => {
    expect(buildSelfBaseBlock(null)).toBe('');
    expect(buildSelfBaseBlock(undefined)).toBe('');
    expect(buildSelfBaseBlock({})).toBe('');
  });

  it('設定済みフィールドを見出し付きで出す（一人称・源氏名を含む）', () => {
    const out = buildSelfBaseBlock({ stageName: 'ルナ', firstPerson: 'うち', defaultTone: 'フランク' });
    expect(out).toContain('## 自分のベース文体（必ず反映）');
    expect(out).toContain('ルナ');
    expect(out).toContain('うち');
    expect(out).toContain('フランク');
  });

  it('見出しは差し替え可能', () => {
    const out = buildSelfBaseBlock({ stageName: 'ルナ' }, '## 別見出し');
    expect(out).toContain('## 別見出し');
  });

  it('avgLength=0 は情報として出さない（falsy スキップ）', () => {
    expect(buildSelfBaseBlock({ avgLength: 0 })).toBe('');
  });
});

describe('buildStoreProfileBlock', () => {
  it('null・シグナル無しは空文字', () => {
    expect(buildStoreProfileBlock(null)).toBe('');
    // storeType(enum) だけでは弱シグナル扱いで出さない（storeTypeName / name のどちらか必須）
    expect(buildStoreProfileBlock({ storeType: 'cabaret' })).toBe('');
  });

  it('事業 WS は「店舗名」、個人 WS は「ワークスペース名」で出す', () => {
    const biz = buildStoreProfileBlock({ name: 'ミラージュ', type: 'business', storeTypeName: '中小キャバ' });
    expect(biz).toContain('店舗名: ミラージュ');
    expect(biz).toContain('業種: 中小キャバ');
    const personal = buildStoreProfileBlock({ name: '自分の記録', type: 'personal', storeTypeName: 'フリー' });
    expect(personal).toContain('ワークスペース名: 自分の記録');
  });

  it('自由入力業種(storeTypeName)を enum(storeType)より優先して表示', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'メンズコンセプトカフェ', storeType: 'cabaret' });
    expect(out).toContain('業種: メンズコンセプトカフェ');
    expect(out).not.toContain('業種: cabaret');
  });

  it('電話番号はプロンプトに出さない（PII を AI へ渡さない）', () => {
    const out = buildStoreProfileBlock({ name: 'X', storeTypeName: 'バー', phoneNumber: '090-1234-5678' });
    expect(out).not.toContain('090-1234-5678');
    expect(out).not.toContain('090');
  });
});

describe('composePlaybookAndSelf — 合成順序', () => {
  it('STRICT_RULES_BLOCK を先頭に置き、以降にプレイブック・店舗・自己ブロックを連結', () => {
    const { combined, selfBlock, storeBlock } = composePlaybookAndSelf({
      storeType: 'host',
      selfData: { firstPerson: 'オレ' },
      storeProfile: { name: 'X', storeTypeName: 'ホストクラブ', type: 'business' },
    });
    // 一人称ガード（STRICT）が最優先＝先頭
    expect(combined.startsWith(STRICT_RULES_BLOCK)).toBe(true);
    // 自己ブロック・店舗ブロックが合成に含まれる
    expect(combined).toContain(selfBlock);
    expect(combined).toContain(storeBlock);
    // 店舗ブロックは自己ブロックより前（composePlaybookAndSelf の並び）
    expect(combined.indexOf(storeBlock)).toBeLessThan(combined.indexOf(selfBlock));
  });
});
