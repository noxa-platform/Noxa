import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// 「無音の失敗」再発防止ガード（Day106-PM 新設 → Day107 で債務完済・素のガードへ）。
//
// Day106 で潰したのは、Firestore への書き込みを
//   try { await 書き込み(); 閉じる(); } finally { setBusy(false); }
// と書いて **catch を持たない**パターン。権限エラー/通信断でも画面には何も出ず、
//   - ダイアログ/フォームは開いたまま無反応（保存できたのか分からない）
//   - 行操作は「押しても状態が変わらないだけ」
// になる。売上・勤怠・席回し（Day106 朝）に続き、予約・体験入店・顧客台帳・売掛・出勤予定
// （Day106-PM）でも同型が出た ＝ これは書き癖であり、都度のレビューでは落ちる。
//
// このテストは components を静的に走査して次を落とす:
//   1. 例外の中身を生のまま画面へ出していないか（`String((e as Error)?.message)` 等）
//      → 失敗文言は src/lib/firestore-error.ts の describeFirestoreError に集約する
//   2. `finally` で busy を戻すだけの try（＝catch が無い）に await 書き込みが入っていないか
//      → Day107 で **全件返済**（inventory/transport/risk/schedule/business-card/notifications）したため、
//        ラチェットの KNOWN_DEBT は撤去。以後は**1件でも増えたら赤**の素のガード。
//   3. 購読（onSnapshot）の失敗を「console.warn だけ」「空リストを入れるだけ」で終わらせていないか
//      → **読み取りの無音**は「機能が壊れている」ことすら見えない（Day107/108）。
//        権限エラーでも「予約0件」「出禁客なし」「売掛なし」と同じ表示になり、
//        現場は誤った判断（入店させる・回収し忘れる・予約を見落とす）をする。

const COMPONENTS_ROOT = join(process.cwd(), 'src/components');
// Day109: 走査対象を hooks / ストア（src/lib）まで広げる。
// 画面だけを見ていたため、`useShopId` や POS/席回しストアが**画面より手前で**
// 読み取り失敗を握り潰していたのを取り逃していた（＝どの画面も直せば直るように見えて直らない）。
const LIB_ROOT = join(process.cwd(), 'src/lib');
// Day110: さらに `src/app` のクライアント画面（page.tsx 等）も対象へ。
// 店舗設定の保存・プロフィール保存が **catch 無しのまま**残っていたのを取り逃していた
// （画面は `src/components` だけにあるという前提が崩れている）。
// `src/app/api` は**サーバのルート**で、console.warn はサーバログとして妥当なので除外する。
const APP_ROOT = join(process.cwd(), 'src/app');

function sourceFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const load = (paths: string[]) =>
  paths.map((p) => ({ path: relative(process.cwd(), p).split(/[\\/]/).join('/'), src: readFileSync(p, 'utf8') }));

const FILES = load(sourceFiles(COMPONENTS_ROOT, ['.tsx']));
/** `src/app` のクライアント画面（api ルートは除外） */
const APP_FILES = load(sourceFiles(APP_ROOT, ['.tsx', '.ts'])).filter((f) => !f.path.startsWith('src/app/api/'));
/** 画面＋hooks/ストア（文言・catch の規律はどこにも同じく効かせる） */
const ALL_FILES = [...FILES, ...APP_FILES, ...load(sourceFiles(LIB_ROOT, ['.ts', '.tsx']))];

/** ファイルごとの「catch 無しで finally だけの try に書き込みがある」件数 */
function countCatchlessWrites(src: string): number {
  // `try { … await addDoc/updateDoc/deleteDoc/setDoc/runTransaction … } finally { … }`
  // の形（間に catch が挟まらないもの）を検出する。ネストは深追いせず、
  // 「try の直後に catch を挟まず finally が来る」ケースだけを見る。
  const WRITE = /\b(addDoc|updateDoc|deleteDoc|setDoc|runTransaction)\s*\(/;
  const re = /\btry\s*\{([\s\S]*?)\}\s*(catch|finally)\b/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === 'finally' && WRITE.test(m[1])) n += 1;
  }
  return n;
}

describe('無音の失敗ガード', () => {
  it('走査対象の component が取れている（グロブ破綻の空振り防止）', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('走査対象に hooks/ストア（src/lib）と app 画面（src/app・api 除く）も入っている', () => {
    expect(ALL_FILES.length).toBeGreaterThan(FILES.length + 20);
    expect(ALL_FILES.some((f) => f.path === 'src/lib/useShopId.ts')).toBe(true);           // Day109
    expect(ALL_FILES.some((f) => f.path === 'src/app/store/settings/page.tsx')).toBe(true); // Day110
    expect(ALL_FILES.some((f) => f.path.startsWith('src/app/api/'))).toBe(false);           // サーバは対象外
  });

  it('例外の中身を生のまま画面に出さない（文言は describeFirestoreError に集約する）', () => {
    // 旧実装: window.alert(String((e as Error)?.message ?? e)) —— 現場に「permission-denied」と出るだけ
    // POS/席回しストアも同型で、店舗解決の失敗を生の message のまま画面に載せていた（Day109）
    //
    // 判定は「**画面へ渡している**」に限定する（Day110）。`(e as Error).message` を
    // `auth/credential-already-in-use` 等の**分類に使い、そのあと日本語へマップする**コード
    // （account/connections・account/merge）は現場に生コードを見せないので対象外。
    const RAW_TO_UI = /(set\w*Error\w*|window\.alert|alert)\(\s*String\(\(e as Error\)|(set\w*Error\w*)\(\s*\(e as Error\)\??\.message/;
    const offenders = ALL_FILES.filter((f) => RAW_TO_UI.test(f.src)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('書き込みを含む try が catch 無しで finally だけ、になっていない（1件でも増えたら赤）', () => {
    const offenders = ALL_FILES
      .map((f) => ({ path: f.path, count: countCatchlessWrites(f.src) }))
      .filter((r) => r.count > 0)
      .map((r) => `${r.path}（${r.count}件）`);
    expect(offenders).toEqual([]);
  });

  it('購読（onSnapshot）の失敗を console.warn だけで終わらせない（空表示と区別できなくなる）', () => {
    // 在庫・送迎は購読エラーを console.warn するだけで、権限エラーでも
    // 「1件も無い」と同じ空表示になっていた（Day107 で state に載せて画面へ出した）。
    // console.warn の直後（同じハンドラ内）で state を更新しているかを見る。
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('console.warn(')) return;
        const window = lines.slice(i, i + 4).join('\n');
        if (!/\bset[A-Z]\w*\(/.test(window)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('購読の失敗を「空リストを入れるだけ」で終わらせない（0件表示と区別できなくなる）', () => {
    // 旧実装: onSnapshot(ref, ok, () => setXSnap({ path, list: [] }))
    //   → 出所を確定して loading は解けるが、画面は「1件も無い」と同じになる。
    // 空リストを入れるエラーハンドラは、同じハンドラ内で失敗も state に載せること。
    //
    // 判定: `list: []` を含む行から**直近の `=>`（ハンドラの入口）まで戻り**、
    // そのハンドラ本体の範囲（`});` / `),` / 行末の `;` まで・最大8行）だけを見る。
    // 成功コールバック側の setReadError(null) を誤って拾わないよう、窓ではなく本体で判定する。
    const ERROR_STATE = /\bset\w*Error\w*\(/;
    const offenders: string[] = [];
    for (const { path, src } of FILES) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/list:\s*\[\]/.test(line)) return;
        // ハンドラの入口（=> を含む行）を最大3行遡って探す
        let start = -1;
        for (let j = i; j >= Math.max(0, i - 3); j -= 1) {
          if (lines[j].includes('=>')) { start = j; break; }
        }
        if (start < 0) return; // ハンドラ外の list: []（初期値など）は対象外
        // 本体の終わりを探す（同じ行で閉じる単文アローも含む）
        let body = '';
        for (let j = start; j < Math.min(lines.length, start + 8); j += 1) {
          body += `${lines[j]}\n`;
          if (j > start && /^\s*(\}\)|\),|\}\);)/.test(lines[j])) break;
          if (j === start && /=>[^{]*\)\s*[;,]\s*$/.test(lines[j])) break; // 単文アローで完結
        }
        if (!ERROR_STATE.test(body)) offenders.push(`${path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
