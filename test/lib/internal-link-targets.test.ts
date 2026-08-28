import { describe, it, expect } from 'vitest';
import { stripComments } from '../helpers/strip-comments';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// 内部リンク／遷移先が **実在するページ** に解決できるかの照合（Day112）。
//
// 発端: Day111 で `calendar/callback` が存在しない `/calendar` `/calendar/connect` へ戻しており、
// 連携の成否にかかわらず 404 に着地していた。同型を横断で洗ったところ、
// **ログイン画面の「パスワードを忘れた？」→ `/account/reset` も存在しなかった**
// （＝メール＋パスワード登録者はパスワードを忘れた時点でアカウントに入れない）。
//
// 到達性の穴は「API も rules も正しいのに機能が丸ごと使えない」形で出るうえ、
// 型チェックにも lint にも引っかからない（ただの文字列なので）。ここで静的に落とす。

const APP_ROOT = join(process.cwd(), 'src/app');
const SRC_ROOT = join(process.cwd(), 'src');

function walk(dir: string, pick: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, pick));
    else if (pick(e.name)) out.push(p);
  }
  return out;
}

/** src/app のディレクトリ構造から実在ルートを組む（route group `(x)` と private `_x` は除外） */
const ROUTES: string[] = walk(APP_ROOT, (n) => n === 'page.tsx' || n === 'page.ts' || n === 'route.ts')
  .map((p) => relative(APP_ROOT, p).split(/[\\/]/).slice(0, -1))
  .map((segs) => segs.filter((s) => !s.startsWith('(') && !s.startsWith('_')))
  .map((segs) => `/${segs.join('/')}`.replace(/\/$/, '') || '/');

/** 動的セグメント（[id] / [...slug]）を考慮した実在判定 */
function routeExists(target: string): boolean {
  const t = target.split('/').filter(Boolean);
  return ROUTES.some((r) => {
    const rs = r.split('/').filter(Boolean);
    if (rs.some((s) => s.startsWith('[...'))) {
      return rs.slice(0, -1).every((s, i) => s.startsWith('[') || s === t[i]);
    }
    if (rs.length !== t.length) return false;
    return rs.every((s, i) => s.startsWith('[') || s === t[i]);
  });
}

/** `href="/x"` / `router.push('/x')` / `redirect(new URL('/x'))` などの内部パスを集める */
function collectTargets(): { target: string; where: string }[] {
  // 文字列リテラル**全体**を取る（途中で切ると `/u/${handle}` が `/u` に化けて誤検知になる）。
  // 変数を含むもの（`${`）は行き先が静的に決まらないので判定対象外。
  const PATTERNS = [
    /href=["']([^"'`]*)["']/g,
    /href=\{`([^`]*)`\}/g,
    /router\.(?:push|replace)\(\s*[`'"]([^`'"]*)[`'"]/g,
    /(?:NextResponse\.)?redirect\(\s*new URL\(\s*[`'"]([^`'"]*)[`'"]/g,
    /(?:NextResponse\.)?redirect\(\s*[`'"]([^`'"]*)[`'"]/g,
  ];
  const out: { target: string; where: string }[] = [];
  for (const file of walk(SRC_ROOT, (n) => n.endsWith('.tsx') || n.endsWith('.ts'))) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const where = relative(process.cwd(), file).split(/[\\/]/).join('/');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const lit = m[1];
        // 変数入り・外部 URL・非パスは対象外（内部の静的パスだけを見る）
        if (lit.includes('${') || !lit.startsWith('/') || lit.startsWith('//')) continue;
        const raw = lit.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
        out.push({ target: raw, where });
      }
    }
  }
  return out;
}

const TARGETS = collectTargets();

// まだ作られていないページ（内容が事業判断のため grind では作らない）。
// **ここに足すのは「作らない理由」を書けるものだけ**。作ったら必ずこの一覧から消す。
const KNOWN_MISSING: Record<string, string> = {
  // /terms と /privacy は 2026-08-21 に実体を作った（`src/app/{terms,privacy}/page.tsx`）。
  // 未作成のまま放置していた間、ランディングと会員登録から 404 へリンクしており、
  // yorulog-ios の App Store 提出もこの 404 で止まっていた。
  // このテストは「作ったのに一覧に残っている」を検出して、実際にここへ導いた。
};

describe('内部リンクの遷移先が実在する', () => {
  it('走査が空振りしていない（ルートもリンクも取れている）', () => {
    expect(ROUTES.length).toBeGreaterThan(50);
    expect(TARGETS.length).toBeGreaterThan(30);
    expect(ROUTES).toContain('/account/login');
  });

  it('★存在しないページへのリンク・リダイレクトが無い（1件でも増えたら赤）', () => {
    const offenders = TARGETS
      .filter(({ target }) => !(target in KNOWN_MISSING))
      .filter(({ target }) => !routeExists(target))
      .map(({ target, where }) => `${target} ← ${where}`);
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it('パスワード再設定に到達できる（Day112 の実バグ。導線とページの両方を固定）', () => {
    expect(routeExists('/account/reset')).toBe(true);
    const login = stripComments(readFileSync(join(APP_ROOT, 'account/login/page.tsx'), 'utf8'));
    expect(login).toContain('/account/reset');
  });

  it('未作成ページの一覧が実態と合っている（作ったのに残っている＝一覧の腐り防止）', () => {
    const stale = Object.keys(KNOWN_MISSING).filter((p) => routeExists(p));
    expect(stale).toEqual([]);
  });

  it('未作成ページは実際に参照されている（消えたリンクを一覧に残さない）', () => {
    const referenced = new Set(TARGETS.map((t) => t.target));
    const unused = Object.keys(KNOWN_MISSING).filter((p) => !referenced.has(p));
    expect(unused).toEqual([]);
  });
});
