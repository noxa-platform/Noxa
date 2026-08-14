import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// サーバ側（`src/app/api`）の「無音の失敗」ガード（Day116 新設）。
//
// 今週作った無音ガード（test/lib/silent-failure-coverage.test.ts）は
// **クライアント専用**で、`src/app/api` を明示的に除外していた（console.warn は
// サーバログとして妥当、という理由）。その結果、route 側だけが一度も走査されないまま残り、
// 実際に次が見つかった:
//
//   - `team/member-stats`: 来店ログ・個人売上・顧客数の取得失敗をすべて null/0 に倒し、
//     **200 で返して**いた。画面は「今月の売上 0・顧客 0」と表示され、本物の 0 と区別できない
//     （成績・給与の判断材料になる数字）。
//   - `community/admin/reports`: 通報対象の取得失敗を `(削除済み)` として返しており、
//     運営が「もう消えている」と判断して通報を閉じてしまう（Day109 の型のサーバ版）。
//   - `calendar/list` ほか: **理由をログにも残さず** 500 を返す（運用者が原因を追えない）。
//
// サーバの無音はクライアントの無音より厄介で、画面には何も出ないうえ、
// ログにも残らないと**起きたことすら分からない**。ここで静的に落とす。

const API_ROOT = join(process.cwd(), 'src/app/api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const ROUTES = routeFiles(API_ROOT).map((p) => ({
  path: relative(process.cwd(), p).split(/[\\/]/).join('/'),
  src: readFileSync(p, 'utf8'),
}));

/** catch 節の本体の範囲（開始/終了インデックス）を波括弧の対応で切り出す */
function catchSpans(src: string): [number, number][] {
  const out: [number, number][] = [];
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
    out.push([HEAD.lastIndex, i - 1]);
  }
  return out;
}

/** catch 節の本体を切り出す */
function catchBodies(src: string): { body: string; line: number }[] {
  return catchSpans(src).map(([a, b]) => ({ body: src.slice(a, b), line: src.slice(0, a).split('\n').length }));
}

const LOGGED = /console\.(error|warn)|logger\./;

describe('API route の無音の失敗ガード', () => {
  it('走査対象の route が取れている（グロブ破綻の空振り防止）', () => {
    expect(ROUTES.length).toBeGreaterThan(30);
  });

  it('5xx を返す catch は理由をサーバログに残す（残さないと運用者が原因を追えない）', () => {
    const offenders: string[] = [];
    for (const { path, src } of ROUTES) {
      for (const { body, line } of catchBodies(src)) {
        if (!/status:\s*5\d\d/.test(body)) continue;
        if (LOGGED.test(body)) continue;
        offenders.push(`${path}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('catch の外で返す 5xx も理由をログに残す（Day116-PM で追加）', () => {
    // Day116 のルール①は **catch 節の中だけ** を見ていた。実際には
    // 「モデルの生成物が読めない」「全カレンダーが取れない」「環境変数が無い」のように
    // catch の外で 5xx を組み立てる経路が 11 箇所あり、その 10 箇所が完全に無言だった
    // （＝本番で 500 が出ても、何が起きたのか運用者が一切追えない）。
    const ALLOW: { path: string; needle: string; why: string }[] = [
      { path: 'src/app/api/ai/benchmark/route.ts', needle: 'OPENROUTER_API_KEY が未設定', why: '開発者向けの検証 route。応答本文が理由そのもの' },
      { path: 'src/app/api/ai/benchmark/route.ts', needle: 'OpenRouter ${res.status}', why: '上流の本文を detail として応答に載せている（呼び出した本人が読める）' },
    ];
    const offenders: string[] = [];
    for (const { path, src } of ROUTES) {
      const spans = catchSpans(src);
      const lines = src.split('\n');
      for (const m of src.matchAll(/status:\s*5\d\d/g)) {
        const idx = m.index ?? 0;
        if (spans.some(([a, b]) => idx >= a && idx < b)) continue; // ルール① の担当
        const line = src.slice(0, idx).split('\n').length;
        // 応答を組み立てる直前（6行）にログがあるかを見る。ログは 5xx を返すより前に置く
        const around = lines.slice(Math.max(0, line - 6), line + 1).join('\n');
        if (LOGGED.test(around)) continue;
        if (ALLOW.some((a) => a.path === path && around.includes(a.needle))) continue;
        offenders.push(`${path}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('取得の失敗を既定値へ倒すときは、ログか応答のどちらかで必ず知らせる', () => {
    // `.catch(() => null)` のように**何も言わずに**既定値へ倒すと、呼び出し側からは
    // 「データが無い」と同じに見える。ログに残すか、応答（incomplete 等）に載せること。
    // 表示名だけは uid 先頭へ劣化して画面に見えるので、そこは対象外にしている。
    const SILENT_FALLBACK = /\.catch\(\s*(\([^)]*\)|\w+)\s*=>\s*(null|undefined|\[\]|0)\s*\)/g;
    const offenders: string[] = [];
    for (const { path, src } of ROUTES) {
      for (const m of src.matchAll(SILENT_FALLBACK)) {
        const line = src.slice(0, m.index ?? 0).split('\n').length;
        // 直後 3 行以内に「劣化を明示する」記述（フォールバック名の説明）があるかを見る
        const around = src.split('\n').slice(Math.max(0, line - 3), line + 3).join('\n');
        if (/uid\.slice|displayName|castDisplayName/.test(around)) continue; // 画面に劣化が見える
        if (/request\.json\(\)/.test(m[0]) || /json\(\)\s*\.catch/.test(around)) continue; // body パースの既定 {}
        offenders.push(`${path}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('エラー応答を「空配列」で返さない（成功と同じ形＝0件と区別できない・Day116-PM で追加）', () => {
    // `NextResponse.json([], { status: 401 })` は本文だけ見ると成功時の「0件」と同一。
    // 呼び出し側が status を見落とすと**静かに「予定なし／カレンダーなし」**として表示される。
    // Day116 は calendar/list の 500 経路だけ直しており、401 の 2 経路が空配列のまま残っていた。
    const offenders: string[] = [];
    for (const { path, src } of ROUTES) {
      for (const m of src.matchAll(/NextResponse\.json\(\s*\[\s*\]\s*,\s*\{\s*status:/g)) {
        offenders.push(`${path}:${src.slice(0, m.index ?? 0).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('集計 route は部分的に読めなかったことを応答で伝える（0 と区別できるように）', () => {
    // member-stats は売上・顧客数を集計して返す。読めなかった分を黙って 0 にすると
    // 「実績なし」と見分けが付かない（給与・評価の判断に使う数字）。
    const src = ROUTES.find((r) => r.path === 'src/app/api/team/member-stats/route.ts')?.src ?? '';
    expect(src).toMatch(/incomplete/);
    expect(src).toMatch(/incomplete\.push\(/);
  });

  it('通報一覧は「取得失敗」と「削除済み」を区別して返す', () => {
    const src = ROUTES.find((r) => r.path === 'src/app/api/community/admin/reports/route.ts')?.src ?? '';
    // 判定を持つだけでは足りない。**応答に載せて**初めて管理画面が区別できる
    expect(src).toMatch(/fetchFailed = true/);
    expect(src).toMatch(/^\s*fetchFailed,\s*$/m);
    // 取得失敗と削除済みで文言が分かれていること
    expect(src).toMatch(/fetchFailed \? '\(本文を取得できませんでした\)' : '\(削除済み\)'/);
  });
});
