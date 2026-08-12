import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// 「無音の失敗」再発防止ガード（Day106-PM）。
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
//      → 未返済分は KNOWN_DEBT に**件数つき**で明記する。ラチェット式で:
//        ・新しいファイルで同じ書き方をしたら赤（債務を増やせない）
//        ・既知ファイルで件数が増えたら赤
//        ・件数が減ったら赤（返済したら KNOWN_DEBT を更新させる＝一覧が実態から腐らない）

const COMPONENTS_ROOT = join(process.cwd(), 'src/components');

/**
 * catch 無しの書き込みが残っている画面（返済待ち・Day107 以降の作業対象）。
 * 値は検出件数。ここに載っている＝「無音のまま」と分かっていて未対応、の意味。
 */
const KNOWN_DEBT: Record<string, number> = {
  'src/components/modules/business-card/BusinessCardClient.tsx': 1,
  'src/components/modules/inventory/InventoryClient.tsx': 6,
  'src/components/modules/notifications/NotificationsClient.tsx': 1,
  'src/components/modules/risk/RiskClient.tsx': 3,
  'src/components/modules/schedule/ScheduleClient.tsx': 1,
  'src/components/modules/transport/TransportClient.tsx': 6,
};

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

  it('catch 無しの書き込みが新しいファイルに増えていない（債務は KNOWN_DEBT のみ）', () => {
    const found = FILES
      .map((f) => ({ path: f.path, count: countCatchlessWrites(f.src) }))
      .filter((r) => r.count > 0);
    const unexpected = found.filter((r) => KNOWN_DEBT[r.path] === undefined).map((r) => r.path);
    expect(unexpected).toEqual([]);
  });

  it('既知ファイルの件数が増えていない / 返済したら KNOWN_DEBT を更新する', () => {
    const actual: Record<string, number> = {};
    for (const f of FILES) {
      const n = countCatchlessWrites(f.src);
      if (n > 0 || KNOWN_DEBT[f.path] !== undefined) actual[f.path] = n;
    }
    // 期待値そのままの比較。増えたら赤／減っても赤（＝一覧が実態から腐らない）
    expect(actual).toEqual(KNOWN_DEBT);
  });

  it('KNOWN_DEBT に実在しないパスが残っていない（削除・改名の取りこぼし検知）', () => {
    const known = new Set(FILES.map((f) => f.path));
    const stale = Object.keys(KNOWN_DEBT).filter((p) => !known.has(p));
    expect(stale).toEqual([]);
  });
});
