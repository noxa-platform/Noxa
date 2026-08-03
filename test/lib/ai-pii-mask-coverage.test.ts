import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// AI route 全体の PII マスク網羅ガード（Day99）。
//
// Day12 で「顧客のフリーテキストを AI プロバイダへ送る前に電話/メールをマスクする」
// ポリシーを定めたが、実際には ai/chat と ai/message にしか適用されておらず、
// insights / briefing / message/reply / customer-infer-profile は素通しだった（Day99 で是正）。
// 原因は「新しい AI route を足すときにマスクを付け忘れても誰も気づかない」こと。
//
// このテストは route を静的に走査して分類漏れを落とす:
//   - 顧客のフリーテキスト（likesNote / ngNote / importantMemo / chatHistory 等）を扱う route は
//     必ず MASKED（マスクして AI へ送る）か WRITE_ONLY（AI へ送らず書き込むだけ）に分類されている
//   - MASKED に載っている route は maskDeep / maskContactInfo を実際に import している
// 新しい route が増えたら、このテストが「未分類」で赤くなるので判断を強制できる。

const API_ROOT = join(process.cwd(), 'src/app/api');

/** 顧客の自由記述フィールド。ここに電話番号・メールが書かれる。 */
const FREE_TEXT_FIELDS = /likesNote|dislikesNote|ngNote|importantMemo|chatHistory/;

/** 保存済みの顧客フリーテキストを AI プロンプトに載せる route（＝マスク必須） */
const MASKED = [
  'ai/briefing/route.ts',
  'ai/chat/route.ts',
  'ai/customer-infer-profile/route.ts',
  'ai/insights/route.ts',
  'ai/message/reply/route.ts',
  'ai/message/route.ts',
];

/**
 * フリーテキスト「書込み側」の route。AI への入力はユーザー自身が貼ったテキストや
 * スクショで、保存済みの顧客フリーテキストをプロンプトに載せないためマスク対象外。
 * （ユーザー本人の入力を本人向けに処理するだけなので Day12 の想定外）
 */
const WRITE_ONLY = [
  'ai/customer-context-extract/route.ts',
  'ai/learn-from-text/route.ts',
  'ai/message/analyze/route.ts',
];

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

describe('AI route の PII マスク網羅（Day12 ポリシー）', () => {
  const touching = listRouteFiles(API_ROOT)
    .filter((f) => FREE_TEXT_FIELDS.test(readFileSync(f, 'utf-8')))
    .map((f) => relative(API_ROOT, f).split(/[\\/]/).join('/'))
    .sort();

  it('顧客フリーテキストを扱う route はすべて分類済み（新規 route はここで落ちる）', () => {
    const classified = new Set([...MASKED, ...WRITE_ONLY]);
    const unclassified = touching.filter((f) => !classified.has(f));
    expect(unclassified).toEqual([]);
  });

  it('分類表に実在しない route が残っていない（削除・改名の取りこぼし検知）', () => {
    const stale = [...MASKED, ...WRITE_ONLY].filter((f) => !touching.includes(f));
    expect(stale).toEqual([]);
  });

  it.each(MASKED)('%s はマスクヘルパーを import している', (rel) => {
    const src = readFileSync(join(API_ROOT, rel), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*mask(Deep|ContactInfo)[^}]*\}\s*from\s*'@\/lib\/ai-privacy'/);
  });
});
