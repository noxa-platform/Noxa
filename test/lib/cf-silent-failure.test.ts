import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '../helpers/strip-comments';

// Cloud Functions（`functions/src`）の「無音の失敗」ガード（Day118 新設）。
//
// 今週はクライアント（Day106〜115・117）と API route（Day116）を走査したが、
// **CF だけが一度も走査されていなかった**。CF の無音はこの中で一番たちが悪い:
//   - 実行は非同期でユーザーの目の前に無い（画面には何も出ない）
//   - 握り潰すと**関数が「成功」として終了する**ので、再試行もアラートも起きない
//   - 直すべき事実（売上が欠けた・逆引きが残った）は誰にも届かない
//
// 実際に見つかった例:
//   - `sales-sync`: `account_users` の確認失敗を「対象外の uid」に倒し、売上の投影を丸ごとスキップ
//   - `v2-sync`: 公開プロフィール／逆引き index の削除失敗を握り潰し（消したはずの店舗が公開されたまま）
//   - `community-moderation`: 通報の集計失敗を「通報ゼロ」と同じ扱いにして自動非表示を素通り
//
// 判定は「握り潰したまま黙るな」の1点。ログを残すか、throw して関数の失敗として記録させること。

const CF_ROOT = join(process.cwd(), 'functions/src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = tsFiles(CF_ROOT).map((p) => ({
  path: relative(process.cwd(), p).split(/[\\/]/).join('/'),
  src: stripComments(readFileSync(p, 'utf8')),
}));

/** catch 節の本体を波括弧の対応で切り出す */
function catchBodies(src: string): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = [];
  const HEAD = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = HEAD.exec(src)) !== null) {
    let i = HEAD.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      i += 1;
    }
    out.push({ body: src.slice(HEAD.lastIndex, i - 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

// 「報告している」と見なす形。自分でログを書く／throw する／HTTP エラーを返す／
// 収集先へ積む、に加えて **報告専用ヘルパーへ委譲する**形（push.ts の handleSendError）も認める。
const REPORTED = /logger\.(error|warn|info)|console\.(error|warn)|throw\b|res\.status\(|errors\.push\(|reject\(|handle\w*Error\(/;

describe('Cloud Functions の無音の失敗ガード（Day118）', () => {
  it('走査対象の CF ファイルが取れている（グロブ破綻の空振り防止）', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('catch で握り潰したまま黙らない（ログを残すか throw する）', () => {
    // CF は失敗しても画面が無い。黙って return すると「成功した実行」として消える。
    const ALLOWED = new Map<string, string>([
      // 認証済みユーザーの検索で index 起因の失敗を次の手段へ回す（この後の分岐で必ず結論が出る）
      ['functions/src/line-auth.ts', '既存アカウント探索のフォールバック（見つからなければ新規作成へ進む＝結論が出る）'],
    ]);
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      if (ALLOWED.has(path)) continue;
      for (const { body, line } of catchBodies(src)) {
        if (REPORTED.test(body)) continue;
        offenders.push(`${path}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('`.catch(() => 既定値)` で失敗を黙って捨てない', () => {
    // `.catch(() => undefined)` は「失敗しても無かったことにする」と同義。
    // 削除の失敗を捨てると**消したはずのデータが残り続ける**（公開プロフィール・逆引き index・売上控え）。
    const SILENT = /\.catch\(\s*\(\s*\)\s*=>\s*(undefined|null|\{\s*\}|\[\]|0|false)\s*\)/g;
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      for (const m of src.matchAll(SILENT)) {
        offenders.push(`${path}:${src.slice(0, m.index ?? 0).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('売上の投影は「確認できなかった」を「対象外」に倒さない（Day118 の実バグ）', () => {
    // 個人売上・担当台帳が静かに欠けると、成績と給与の材料が欠ける。
    const src = FILES.find((f) => f.path === 'functions/src/sales-sync.ts')?.src ?? '';
    const fn = src.slice(src.indexOf('async function isRealAccount'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/logger\.error/);
    expect(body).toMatch(/throw/);
    expect(body).not.toMatch(/catch\s*\{\s*return false/); // 旧実装へ戻さない
  });

  // --- ガード自身の穴（Day120） ---
  it('判定はコードだけに当てる（コメントの中の書き方例で誤検知しない）', () => {
    const src = "// ここを .catch(() => []) で埋めるな\nconst a = 1;\n";
    expect(stripComments(src)).not.toContain('catch');
    expect(stripComments(src)).toContain('const a = 1;');
  });

  it('★catch 本体がコメントだけの「報告したことにする」を素通りさせない', () => {
    const src = 'try { f(); } catch (e) {\n  // logger.error は不要\n}\n';
    const [only] = catchBodies(stripComments(src));
    expect(REPORTED.test(only.body)).toBe(false);
  });

  it('コメントを潰しても実コードの `.catch(() => [])` は摘発できる', () => {
    const src = 'const u = "https://example.com"; // 説明\nconst x = await q().catch(() => []);\n';
    expect(/\.catch\(\s*\(\s*\)\s*=>\s*(undefined|null|\{\s*\}|\[\]|0|false)\s*\)/.test(stripComments(src))).toBe(true);
  });
});
