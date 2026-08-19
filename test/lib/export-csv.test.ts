import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsv, withBom, csvFileName } from '../../src/lib/export/csv';

// CSV 出力（Day126）。会計事務所・税理士へ渡す実需があるため「人が読む形式」だけ用意する。

describe('escapeCsvCell', () => {
  it('区切り・改行・引用符を含む値を壊さない', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell('普通')).toBe('普通');
  });

  it('null / undefined は空欄（"null" という文字を出さない）', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('★数式として実行され得る値を無害化する（CSV インジェクション）', () => {
    // 顧客名に =HYPERLINK(...) 等が入っていると、開いた表計算ソフトで実行され得る
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell('-5')).toBe("'-5");
  });

  it('数値はそのまま（金額列が文字列にならない）', () => {
    expect(escapeCsvCell(12000)).toBe('12000');
    expect(escapeCsvCell(0)).toBe('0');
  });
});

describe('toCsv', () => {
  const cols = [
    { header: '営業日', value: (r: { d: string; a: number }) => r.d },
    { header: '金額', value: (r: { d: string; a: number }) => r.a },
  ];

  it('見出し＋行を CRLF で出す', () => {
    expect(toCsv([{ d: '2026-08-19', a: 12000 }], cols)).toBe('営業日,金額\r\n2026-08-19,12000');
  });

  it('★0 件でも見出しだけは出す（空ファイルは「壊れている」ように見える）', () => {
    expect(toCsv([], cols)).toBe('営業日,金額');
  });
});

describe('withBom / csvFileName', () => {
  it('★BOM を付ける（付けないと Excel 日本語環境で全部文字化けする）', () => {
    expect(withBom('a')).toBe('﻿a');
  });

  it('ファイル名は期間が分かる形で、記号は落とす', () => {
    expect(csvFileName('noxa_sales', '2026-08')).toBe('noxa_sales_2026-08.csv');
    // パス区切り・親ディレクトリ参照は落ちる（保存先を外へ逃がさない）
    const risky = csvFileName('売上/../etc', '2026-08');
    expect(risky).not.toMatch(/[/\\]|\.\./);
    expect(risky.endsWith('.csv')).toBe(true);
    expect(csvFileName('日本語だけ', '2026-08')).toBe('export_2026-08.csv');
  });
});
