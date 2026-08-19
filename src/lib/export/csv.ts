/**
 * CSV 出力（Day126・純関数）。
 *
 * 「無料で配るが、他社 POS がそのまま取り込める相互運用形式は出さない」という方針のもと、
 * **人が読む・会計事務所へ渡す**ための出力だけを用意する。ここを塞ぐと税理士へ渡す手段が
 * 無くなり、それ自体が導入障壁になる。
 *
 * Excel（日本語環境）で開く前提のため BOM を付ける。付けないと UTF-8 が Shift_JIS と
 * 誤認されて全部文字化けし、「壊れたファイルが出た」という体験になる。
 */

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

/** 1 セルのエスケープ（区切り・改行・引用符を含む値を壊さない） */
export function escapeCsvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // 先頭が = + - @ の値は表計算ソフトが数式として実行しうる（CSV インジェクション）。
  // 先頭に ' を足して無害化する（見た目は崩さない）
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 行と列定義から CSV 本文を作る（BOM 無し・改行は CRLF） */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsvCell(c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

/** Excel が文字化けしないよう BOM を付けた Blob 用文字列 */
export function withBom(csv: string): string {
  return `﻿${csv}`;
}

/** ファイル名（日本語・記号を避け、期間が分かる形にする） */
export function csvFileName(prefix: string, period: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '') || 'export';
  return `${safe}_${period}.csv`;
}
