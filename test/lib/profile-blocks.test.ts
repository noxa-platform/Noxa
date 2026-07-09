// NOXAページ ブロック純ロジックのテスト（Lane B: 壊れデータで落ちない・URL安全性）。
import { describe, it, expect } from 'vitest';
import {
  normalizeBlocks, blocksFromLegacy, createBlock, moveBlock, sanitizeForSave, isSafeUrl, MAX_BLOCKS,
} from '../../src/lib/profile-blocks';

describe('normalizeBlocks（壊れデータ耐性）', () => {
  it('配列以外・null は空配列', () => {
    expect(normalizeBlocks(undefined)).toEqual([]);
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks('junk')).toEqual([]);
    expect(normalizeBlocks({})).toEqual([]);
  });
  it('未知 type・欠落フィールドのブロックは黙って捨てる（前方互換）', () => {
    const raw = [
      { id: 'a', type: 'text', visible: true, v: 1, value: 'こんにちは' },
      { id: 'b', type: 'image', url: 'https://x/img.png' },      // 未知type(Phase2)
      { type: 'text' },                                           // value欠落
      42, null, 'str',                                            // ゴミ
      { id: 'c', type: 'link', url: 'https://example.com', label: 'HP' },
    ];
    const out = normalizeBlocks(raw);
    expect(out.map((b) => b.type)).toEqual(['text', 'link']);
  });
  it('javascript: スキームの link は捨てる（XSS防止）', () => {
    const out = normalizeBlocks([
      { id: 'x', type: 'link', url: 'javascript:alert(1)', label: '罠' },
      { id: 'y', type: 'link', url: 'https://ok.example', label: 'OK' },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0] as { url: string }).url).toBe('https://ok.example');
  });
  it('visible 未指定は true 扱い・id 欠落は自動採番', () => {
    const out = normalizeBlocks([{ type: 'text', value: 'a' }]);
    expect(out[0].visible).toBe(true);
    expect(out[0].id).toBeTruthy();
  });
});

describe('blocksFromLegacy（one-way migration）', () => {
  it('bio → text、sns → link に変換（空/不正URLは除外）', () => {
    const out = blocksFromLegacy({
      bio: '自己紹介です',
      sns: [
        { platform: 'instagram', url: 'https://instagram.com/x' },
        { platform: 'x', url: '' },
        { platform: 'other', url: 'javascript:alert(1)' },
      ],
    });
    expect(out.map((b) => b.type)).toEqual(['text', 'link']);
  });
  it('空 bio・空 sns なら空配列', () => {
    expect(blocksFromLegacy({ bio: ' ', sns: [] })).toEqual([]);
  });
});

describe('moveBlock / sanitizeForSave', () => {
  it('並べ替え（境界外は no-op）', () => {
    const a = createBlock('text', 'A'), b = createBlock('text', 'B');
    expect(moveBlock([a, b], 0, 1).map((x) => (x as { value: string }).value)).toEqual(['B', 'A']);
    expect(moveBlock([a, b], 0, -1).map((x) => (x as { value: string }).value)).toEqual(['A', 'B']);
  });
  it('保存前に空ブロック・不正URLを除外し上限で切る', () => {
    const blocks = [
      createBlock('text', '  '),                                   // 空 → 除外
      createBlock('text', '有効'),
      createBlock('link', { label: 'x', url: 'not-a-url' }),        // 不正URL → 除外
      createBlock('link', { label: 'ok', url: 'https://ok.jp' }),
      ...Array.from({ length: MAX_BLOCKS + 5 }, (_, i) => createBlock('text', `t${i}`)),
    ];
    const out = sanitizeForSave(blocks);
    expect(out.length).toBe(MAX_BLOCKS);
    expect(out.some((b) => b.type === 'link' && (b as { url: string }).url === 'not-a-url')).toBe(false);
  });
});

describe('isSafeUrl', () => {
  it('http/https のみ許可', () => {
    expect(isSafeUrl('https://a.jp')).toBe(true);
    expect(isSafeUrl('http://a.jp')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
    expect(isSafeUrl('線')).toBe(false);
  });
});
