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

/**
 * `try` に入れずに await 書き込みしている「画面を動かす関数」を拾う（Day112）。
 *
 * 既存の判定は `try { … } finally { … }` の形だけを見ていたため、**try 自体が無い**書き癖を
 * 取り逃していた（`/account/notifications` の保存がこれで、失敗するとボタンが「保存中…」のまま固まる）。
 * 呼び出し側で catch する薄いラッパ（本体が書き込み1行だけ）まで赤にすると誤検知になるので、
 * **自分で画面状態を更新している関数**（`set*(...)` を含む）に限定する。
 */
function bareWriteHandlers(src: string): number {
  const WRITE = new RegExp(String.raw`await\s+(` + WRITE_SRC + `)`);
  const HEAD = /(async function\s+\w+\s*\([^)]*\)\s*\{|const\s+\w+\s*=\s*async\s*\([^)]*\)\s*=>\s*\{)/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = HEAD.exec(src)) !== null) {
    // 関数本体を波括弧の対応で切り出す
    let i = HEAD.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      i += 1;
    }
    const body = src.slice(HEAD.lastIndex, i);
    // Day117: ストアの書き込みは失敗を opError に載せて **成功可否を boolean で返す**ようになった。
    // `if (await store.x(...)) setY()` のように**結果で分岐している**なら catch は要らない
    // （失敗の表示はストアの共通バナーが担当する）。結果を捨てた `await store.x(...);` だけを赤にする。
    const discarded = new RegExp(String.raw`(^|[;{}\n]\s*)await\s+(` + WRITE_SRC + `)`).test(body);
    if (WRITE.test(body) && discarded && !/\bcatch\b/.test(body) && /\bset[A-Z]\w*\(/.test(body)) n += 1;
  }
  return n;
}

/** ファイルごとの「catch 無しで finally だけの try に書き込みがある」件数 */
/**
 * 「書き込み」の判定（Day115）。
 *
 * 旧実装は Firestore API の**直呼び**（addDoc 等）だけを書き込みと見なしていたため、
 * **ストア経由の書き込み**（`await store.savePanelMeta(...)` のように useXxxStore が
 * 内部で setDoc する形）が全判定を素通りしていた。実際に初回案内の
 * パネル保存とオーダー送信が catch 無しのまま残り、失敗しても画面に何も出ていなかった。
 * ストアのメソッド名は増えるので、**`store.` 経由の await 呼び出し**を書き込み候補として扱う。
 */
const WRITE_SRC = String.raw`(addDoc|updateDoc|deleteDoc|setDoc|runTransaction)\s*\(|store\.\w+\s*\(`;

function countCatchlessWrites(src: string): number {
  // `try { … await addDoc/updateDoc/deleteDoc/setDoc/runTransaction … } finally { … }`
  // の形（間に catch が挟まらないもの）を検出する。ネストは深追いせず、
  // 「try の直後に catch を挟まず finally が来る」ケースだけを見る。
  const WRITE = new RegExp(WRITE_SRC);
  const re = /\btry\s*\{([\s\S]*?)\}\s*(catch|finally)\b/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[2] === 'finally' && WRITE.test(m[1])) n += 1;
  }
  return n;
}

/**
 * **中身が空のエラーハンドラ**を拾う（Day115）。
 *
 * これまでの判定はすべて「ハンドラが何かをしている」ことを前提にしていた
 * （console.warn している／空リストを入れている／生 message を画面に出している）。
 * そのため `() => {}` や `.catch(() => {})` のように**何もしないハンドラ**は、
 * 5 つの判定を全部すり抜けていた。実際に
 *   - 店舗設定の発行済み招待（onSnapshot の第3引数が注釈だけの noop）
 *   - 予約からの開卓（pos_config の `.catch(() => { 既定料金のまま })`）
 * が無音のまま残り、後者は**既定料金の伝票が売上まで流れる**形だった。
 *
 * localStorage / clipboard / JSON.parse など「失敗しても実害が無い」ものまで赤にすると
 * 誤検知だらけになるので、**Firestore の購読・取得に付いた空ハンドラ**に限定する。
 */
function emptyFirestoreHandlers(src: string): number {
  const EMPTY = String.raw`\(\s*\w*\s*\)\s*=>\s*\{\s*(/\*[\s\S]*?\*/|//[^\n]*)?\s*\}`;
  let n = 0;
  // onSnapshot(..., success, <空ハンドラ>)
  for (const m of src.matchAll(new RegExp(String.raw`onSnapshot\(` + String.raw`[\s\S]*?` + String.raw`,\s*` + EMPTY + String.raw`\s*\)`, 'g'))) {
    if (m[0].includes('onSnapshot')) n += 1;
  }
  // getDoc/getDocs(...).then(...).catch(<空ハンドラ>)
  for (const m of src.matchAll(new RegExp(String.raw`(getDoc|getDocs)\(` + String.raw`[\s\S]{0,400}?` + String.raw`\.catch\(\s*` + EMPTY + String.raw`\s*\)`, 'g'))) {
    if (m[0]) n += 1;
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

  it('try に入れない裸の await 書き込みで画面を動かしていない（「保存中…」のまま固まる形）', () => {
    const offenders = ALL_FILES
      .map((f) => ({ path: f.path, count: bareWriteHandlers(f.src) }))
      .filter((r) => r.count > 0)
      .map((r) => `${r.path}（${r.count}件）`);
    expect(offenders).toEqual([]);
  });

  it('JSX から投げっぱなしで呼ぶストア操作は、失敗を出す画面でしか使わない（Day117）', () => {
    // これまでの書き込み判定は「名前の付いた関数」か「await された書き込み」しか見ていなかった。
    //   onClick={() => store.checkTable(t.id)}
    // のように **JSX へ直書きした投げっぱなしの呼び出し**は await も catch も関数名も無いので、
    // 8 判定すべてをすり抜けていた（席回し 18・POS 10・初回案内 7 箇所）。接客中の画面で
    // 権限エラー・オフライン・競合が起きても「押しても無反応」にしか見えない状態だった。
    //
    // 対処として、ストア側が失敗を `opError` に集約して boolean を返す契約にした（Day117）。
    // ここでは受け手側を固定する: **投げっぱなしで呼ぶ画面は opError を表示していること**。
    const READ_ONLY = new Set(['resultFor', 'clearOpError']);
    const offenders: string[] = [];
    for (const { path, src } of ALL_FILES) {
      if (!path.endsWith('.tsx')) continue;
      const fireAndForget = [...src.matchAll(/(await\s+)?\bstore\.(\w+)\(/g)]
        .filter((m) => !m[1] && !READ_ONLY.has(m[2]));
      if (fireAndForget.length === 0) continue;
      if (/\bopError\b/.test(src)) continue; // 失敗を画面に出している
      offenders.push(`${path}（${fireAndForget.length}件）`);
    }
    expect(offenders).toEqual([]);
  });

  it('書き込みを公開するストアは失敗の通知経路（useOperationError）を持つ（Day117）', () => {
    // 画面側だけ直しても、次に作るストアが同じ穴を空ける。ストア側の契約も固定する。
    const WRITE = /(addDoc|updateDoc|deleteDoc|setDoc|runTransaction|writeBatch)\s*\(/;
    const offenders = ALL_FILES
      .filter((f) => /^src\/lib\/[\w-]+\/store\.ts$/.test(f.path))
      .filter((f) => WRITE.test(f.src) && !f.src.includes('useOperationError'))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('Firestore の購読・取得に「何もしないエラーハンドラ」を付けない（Day115）', () => {
    // これまでの判定は全部「ハンドラが何かをしている」前提だったので、空ハンドラだけが
    // 5 判定すべてをすり抜けていた（招待一覧の握り潰し・予約の既定料金フォールバック）。
    // 例外は「失敗しても利用者が困らない」ものだけ。理由を必ず添えること
    // （増やすときは、その画面で本当に実害が無いかを確認してから）
    const ALLOWED = new Map<string, string>([
      // 取得できなくても**通す**方向の失敗（ハンドル未設定の誘導）。塞ぐ側に倒すと締め出しになる
      ['src/components/AccountShell.tsx', 'handle 取得失敗時はオンボーディングへ誘導せず素通しする（fail-open が正）'],
      // 名前が引けないときは uid 先頭8桁を表示する＝**劣化が画面に見えている**
      ['src/components/modules/attendance/AttendanceClient.tsx', '名前解決の失敗は uid 表示に劣化して見える'],
      // 連携候補が無くても席回しは成立する（任意機能）
      ['src/components/modules/seating/SeatingClient.tsx', 'メンバー連携は任意機能で、候補なし表示でも運用できる'],
    ]);
    const offenders = ALL_FILES
      .map((f) => ({ path: f.path, count: emptyFirestoreHandlers(f.src) }))
      .filter((r) => r.count > 0 && !ALLOWED.has(r.path))
      .map((r) => `${r.path}（${r.count}件）`);
    expect(offenders).toEqual([]);
  });

  it('購読（onSnapshot）の失敗を console.warn だけで終わらせない（空表示と区別できなくなる）', () => {
    // 在庫・送迎は購読エラーを console.warn するだけで、権限エラーでも
    // 「1件も無い」と同じ空表示になっていた（Day107 で state に載せて画面へ出した）。
    // console.warn の直後（同じハンドラ内）で state を更新しているかを見る。
    const offenders: string[] = [];
    // 開発時のみ動くエミュレータ接続（UI を持たない・本番では通らない）は対象外
    const DEV_ONLY = new Set(['src/lib/firebase/config.ts']);
    for (const { path, src } of ALL_FILES) {
      if (DEV_ONLY.has(path)) continue;
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
    for (const { path, src } of ALL_FILES) {
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
