import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/strip-comments';

// 静的ガード共通ヘルパー `stripComments` の自己テスト（P163 で新設）。
//
// 🔴 **17 本以上のガードがこのヘルパーに乗っているのに、テストが 1 本も無かった。**
// 2026-09-04 に実測して見つけた欠陥:
//   `.replace(/\\"/g, '"')` のような**正規表現リテラルの中の引用符**で文字列モードに入り、
//   **そのファイルの以降のコメントが 1 つも消えない**（＝ そのファイルだけコメント盲のまま）。
//   実害の位置が最悪で、**`ai/chat/route.ts` / `ai/tags/route.ts` /
//   `ai-knowledge/pii-sanitizer.ts` の 3 本**——うち 2 つは PII マスクと
//   prompt-injection の判定対象。P161-PM2 で「一律に当てた」つもりが、
//   **一番当てたい 3 ファイルで効いていなかった。**
//
// ⚠️ 直し方は**許可制**にしてある。`}` や `>` を正規表現の開始と見なすと
// JSX の `/>` を食って行を丸ごと空白に潰す（修正の 1 回目で実際に 2 ファイル壊した）。

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('stripComments の不変条件', () => {
  it('コメントは空白へ潰れ、行番号は保たれる', () => {
    const src = 'const a = 1; // メモ\nconst b = 2;\n';
    const out = stripComments(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('メモ');
    expect(out).toContain('const b = 2;');
  });

  it('文字列の中の // は消さない（誤検知の逆方向）', () => {
    expect(stripComments(`const u = 'https://example.com'; // メモ`)).toContain('https://example.com');
  });

  it('🔴 正規表現リテラル内の引用符で壊れない（この欠陥で 3 ファイルが素通りしていた）', () => {
    const src = `const s = t.replace(/\\\\"/g, '"');\n// 秘密のコメント\n`;
    expect(stripComments(src)).not.toContain('秘密のコメント');
  });

  it('JSX の `/>` を正規表現と誤読して行を潰さない', () => {
    const src = `<input type="checkbox" onChange={(e) => f(e)} />\nconst keep = 1;\n`;
    const out = stripComments(src);
    expect(out).toContain('checkbox');
    expect(out).toContain('const keep = 1;');
  });

  it('リポ全体で「コメントが残るファイル」はテンプレート内の既知 2 件だけ', () => {
    // ⚠️ 残り 2 件は**テンプレートリテラルの中に書かれたコメント**で、
    // 素朴な走査では消せない（テンプレートの中身は文字列として正しい）。
    // 直すのではなく**既知として固定**し、増えたら赤にする。
    const KNOWN = [
      'src/app/api/ai/chat/route.ts',
      'test/lib/write-outcome.test.ts',
    ];
    const files = [...walk('src'), ...walk('functions/src'), ...walk('test')];
    expect(files.length).toBeGreaterThan(300); // グロブ破綻の空振り防止
    const broken: string[] = [];
    for (const f of files) {
      const raw = readFileSync(f, 'utf8');
      const out = stripComments(raw);
      const rl = raw.split('\n');
      const ol = out.split('\n');
      for (let i = 0; i < rl.length; i++) {
        if (rl[i].trim().startsWith('//') && ol[i].trim() !== '') { broken.push(f.split(/[\\/]/).join('/')); break; }
      }
    }
    expect(broken.sort()).toEqual(KNOWN);
  });
});
