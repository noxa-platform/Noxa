import { describe, it, expect } from 'vitest';
import { dataUrlByteSize, qualityLadder } from '../../src/lib/menu/imageCompress';

// 画像圧縮の純ロジック（サイズ算出・品質ラダー）の回帰。
// compressImage 本体は canvas/DOM 依存で node 環境ではテスト不可のため、
// Firestore 1MiB 制限を守る判断に使う純関数だけを固定する。

// base64 でエンコードした既知バイト列の data URL を作るヘルパー
const dataUrlOf = (bytes: number): string => {
  const b64 = Buffer.alloc(bytes).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
};

describe('dataUrlByteSize', () => {
  it('base64 パディング有無を含めデコード後バイト数を正しく返す', () => {
    // "ABC"→"QUJD"(pad0)=3B / "AB"→"QUI="(pad1)=2B / "A"→"QQ=="(pad2)=1B
    expect(dataUrlByteSize(`data:x;base64,${Buffer.from('ABC').toString('base64')}`)).toBe(3);
    expect(dataUrlByteSize(`data:x;base64,${Buffer.from('AB').toString('base64')}`)).toBe(2);
    expect(dataUrlByteSize(`data:x;base64,${Buffer.from('A').toString('base64')}`)).toBe(1);
  });

  it('大きなペイロードのバイト数を返す', () => {
    expect(dataUrlByteSize(dataUrlOf(1000))).toBe(1000);
    expect(dataUrlByteSize(dataUrlOf(950 * 1024))).toBe(950 * 1024);
  });

  it('空文字は 0 / カンマ無しは生文字列長を返す', () => {
    expect(dataUrlByteSize('')).toBe(0);
    expect(dataUrlByteSize('abcd')).toBe(4);
  });
});

describe('qualityLadder', () => {
  it('start 未満の品質のみを降順で返す', () => {
    expect(qualityLadder(0.82)).toEqual([0.7, 0.6, 0.5, 0.42, 0.35, 0.28]);
    expect(qualityLadder(0.6)).toEqual([0.5, 0.42, 0.35, 0.28]);
  });

  it('start が最低品質以下ならラダーは空（これ以上下げない）', () => {
    expect(qualityLadder(0.28)).toEqual([]);
    expect(qualityLadder(0.2)).toEqual([]);
  });

  it('返す品質は常に単調減少かつ start 未満', () => {
    const ladder = qualityLadder(0.82);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
    for (const q of ladder) expect(q).toBeLessThan(0.82);
  });
});
