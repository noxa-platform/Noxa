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

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const FILES = tsxFiles(COMPONENTS_ROOT)
  .map((p) => ({ path: relative(process.cwd(), p).split(/[\\/]/).join('/'), src: readFileSync(p, 'utf8') }));

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

  it('例外の中身を生のまま画面に出さない（文言は describeFirestoreError に集約する）', () => {
    // 旧実装: window.alert(String((e as Error)?.message ?? e)) —— 現場に「permission-denied」と出るだけ
    const RAW = /\(e as Error\)\??\.message/;
    const offenders = FILES.filter((f) => RAW.test(f.src)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('書き込みを含む try が catch 無しで finally だけ、になっていない（1件でも増えたら赤）', () => {
    const offenders = FILES
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
