import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONCEPT_DEFAULT_TERMS, ALL_CONCEPT_IDS, type ConceptId } from '../../src/lib/lexicon/concepts';
import { INDUSTRY_TERMS, resolveTerm } from '../../src/lib/shopConfig';

// 語彙の共有スナップショット（`src/lib/lexicon/lexicon-snapshot.json`）と実装の一致を固定する。
//
// なぜ要るか: **yorulog-ios が 14 概念・既定の呼び名・業種プリセットを複製で持つ**（表示専用）。
// 記録エンジン段 6 の `derivation-cases.json` は「同じ入力を流して答えを比べる」形にできたが、
// 呼び名は**表そのものが答え**なので同じ手は使えない。代わりに**表を書き出して差分で気づく**。
//
// ⚠️ このテストが落ちたということは、**iOS の複製が古くなった**ということ。
// JSON を更新するだけで済ませず、**yorulog-ios へ知らせること**（向こうは自動では気づけない）。
// P100 で「2 箇所に書くと必ずズレる」を踏んでいるので、ズレを検出する仕掛けを先に置く。

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/lexicon/lexicon-snapshot.json'), 'utf8'),
) as {
  conceptIds: string[];
  defaultTerms: Record<string, string>;
  industryPresets: Record<string, Record<string, string>>;
};

describe('語彙スナップショット — iOS の複製とのズレを検出する', () => {
  it('概念 ID が一致する（順序込み。追加も削除も検出する）', () => {
    expect(snapshot.conceptIds).toEqual(ALL_CONCEPT_IDS);
  });

  it('既定の呼び名が 1 文字も違わない', () => {
    expect(snapshot.defaultTerms).toEqual(CONCEPT_DEFAULT_TERMS);
  });

  it('業種プリセットが完全に一致する（業種名も上書きの中身も）', () => {
    expect(snapshot.industryPresets).toEqual(INDUSTRY_TERMS);
  });

  // ⚠️ 業種プリセットの key は `INDUSTRY_TERMS` の照合キー。完全一致で引くので、
  // 前後に空白が混ざると**その業種だけ静かに効かなくなる**（P153-PM20）
  it('業種名に前後の空白が無い（完全一致で引くため）', () => {
    for (const name of Object.keys(snapshot.industryPresets)) {
      expect(name).toBe(name.trim());
    }
  });

  // ⚠️ プリセットが**存在しない概念 ID を上書きしていない**こと。
  // 綴りを間違えても実装は素通りする（`resolveTerm` は key をそのまま返すだけ）ので、
  // 「上書きしたつもりで効いていない」が起きる
  it('プリセットが上書きする概念は全て実在する', () => {
    for (const [industry, terms] of Object.entries(snapshot.industryPresets)) {
      for (const key of Object.keys(terms)) {
        expect(ALL_CONCEPT_IDS, `${industry} の ${key}`).toContain(key as ConceptId);
      }
    }
  });

  // 表と解決関数が本当につながっていることまで見る（表だけ合っていても意味が無い）
  it('スナップショットの内容が resolveTerm の答えと一致する', () => {
    for (const id of snapshot.conceptIds as ConceptId[]) {
      expect(resolveTerm(null, undefined, id)).toBe(snapshot.defaultTerms[id]);
    }
    for (const [industry, terms] of Object.entries(snapshot.industryPresets)) {
      for (const [id, term] of Object.entries(terms)) {
        expect(resolveTerm(null, industry, id)).toBe(term);
      }
    }
  });
});
