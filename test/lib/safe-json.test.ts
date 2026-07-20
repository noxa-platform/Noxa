import { describe, it, expect } from 'vitest';
import { safeParseJson, safeParseStringArray } from '../../src/lib/ai-knowledge/safe-json';

// LLM 応答から JSON/配列を安全に取り出す共通ユーティリティの characterization。
// 多数の AI ルートが依存する（Claude/DeepSeek のマークダウン混入・全角カギ括弧崩れ対策）。
// 文書化されたヒューリスティック（試行順序・失敗時 null/[]）を固定し、退化を検知する。

describe('safeParseJson', () => {
  it('素の JSON をそのままパースする', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeParseJson('{"a":{"b":1}}')).toEqual({ a: { b: 1 } }); // ネストも可
  });

  it('```json / ``` フェンスを剥がしてパースする', () => {
    expect(safeParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeParseJson('```\n{"b":2}\n```')).toEqual({ b: 2 }); // 言語指定なしフェンス
  });

  it('前後に地の文があっても最初の { … 最後の } を抽出する', () => {
    expect(safeParseJson('返答です前置き{"a":1}以上')).toEqual({ a: 1 });
  });

  it('配列 JSON もパースする', () => {
    expect(safeParseJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('パース不能・空・null/undefined は null を返す', () => {
    expect(safeParseJson('これは JSON ではない')).toBeNull();
    expect(safeParseJson('')).toBeNull();
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson(undefined)).toBeNull();
  });

  it('複数オブジェクトが地の文に混在するとヒューリスティックの限界で null（文書化済み挙動）', () => {
    // 最初の { から最後の } を取ると `{"a":1} と {"b":2}` になりパース不能
    expect(safeParseJson('ここに{"a":1} と {"b":2}')).toBeNull();
  });
});

describe('safeParseStringArray', () => {
  it('素の文字列配列をパースする', () => {
    expect(safeParseStringArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  it('```json フェンス／地の文つきでも [ … ] を抽出する', () => {
    expect(safeParseStringArray('```json\n["a","b"]\n```')).toEqual(['a', 'b']);
    expect(safeParseStringArray('返信案:\n["x","y"]')).toEqual(['x', 'y']);
  });

  it('全角カギ括弧/引用符の要素を最終手段で拾う（JSON 崩れ対策）', () => {
    expect(safeParseStringArray('[「案1」「案2」]')).toEqual(['案1', '案2']);
    expect(safeParseStringArray('“foo”と“bar”')).toEqual(['foo', 'bar']);
  });

  it('空配列・非文字列のみ・空文字・null は空配列を返す', () => {
    expect(safeParseStringArray('[]')).toEqual([]);
    expect(safeParseStringArray('[1,2,3]')).toEqual([]); // 文字列以外は落とす
    expect(safeParseStringArray('')).toEqual([]);
    expect(safeParseStringArray(null)).toEqual([]);
    expect(safeParseStringArray(undefined)).toEqual([]);
  });

  it('空白のみの要素は除外する', () => {
    expect(safeParseStringArray('["a","  ",""]')).toEqual(['a']);
  });
});
