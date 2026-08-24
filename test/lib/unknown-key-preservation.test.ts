import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 未知キーの保持（記録エンジン共通仕様 段 2 / `~/dev/noxa-platform/_spec/RECORD-ENGINE.md`）。
//
// 狙いは「読み込み → 保存で、知らないキーを落とさない」こと。他クライアント（iOS / nomishugy）が
// 先に足した新しいフィールドを、古い版の web が保存し直したときに消してしまうと**データが失われる**。
// 後から復旧できない種類なので、仕様でも段 1 の次に置かれている。
//
// 2026-08-25 の全数調査の結論: **noxa に取りこぼしは無かった**。
// Firestore の書き込みは 3 つのどれかで、いずれも未知キーを消さない:
//   (1) `{ merge: true }` のパッチ書き … 既存フィールドを残す（ネストした map も再帰的にマージされる）
//   (2) 存在確認で守られた新規作成 … そもそも上書きする相手がいない
//   (3) doc 全体のコピー（`d.data()` をそのまま渡す）… 未知キーごと運ぶ
// 仕様の「読み込み→保存で落ちる箇所あり」は、少なくとも noxa の書込経路には当てはまらない。
//
// このテストは**それを維持するためのラチェット**。merge なしの書き込みが増えたら落ちる。
// 増やすこと自体は禁止ではない（新規作成なら正しい）が、**必ずここに理由を書かせる**。

const ROOTS = ['src', 'functions/src'];

/**
 * Firestore の書き込みだけを拾う。`res.set()` / `Map.set()` を巻き込まないよう
 * レシーバの形で絞る（`setDoc(` / `〜Ref.set(` / `batch|tx|t.set(` / `〜).set(`）。
 */
const WRITE_CALL = /(?:setDoc\(|\b\w*[Rr]ef\.set\(|\b(?:batch|tx|t)\.set\(|\)\.set\()/g;

/**
 * merge なしで書いている箇所。**すべて「上書きする相手がいない新規作成」**であること。
 * 数が変わったらこの表を更新し、増えた分が本当に新規作成かを確認すること。
 */
const GUARDED_CREATES: { file: string; count: number; why: string }[] = [
  { file: 'src/app/api/community/issue-invite/route.ts', count: 2, why: '招待コードの新規発行（毎回新しい doc）' },
  { file: 'src/app/api/community/redeem-invite/route.ts', count: 1, why: 'userSnap.exists なら return するため新規のみ' },
  { file: 'src/app/api/iap/google-play-grant/route.ts', count: 1, why: 'txSnap.exists で二重付与を弾いた後の新規作成' },
  { file: 'src/app/api/iap/grant/route.ts', count: 1, why: 'txSnap.exists で二重付与を弾いた後の新規作成' },
  { file: 'src/app/api/team/assign-customer/route.ts', count: 1, why: 'doc 全体のコピー（d.data() をそのまま渡す＝未知キーごと運ぶ）' },
  { file: 'src/app/api/team/issue-invite/route.ts', count: 1, why: '招待コードの新規発行' },
  { file: 'src/app/api/team/redeem-invite/route.ts', count: 2, why: 'memberSnap.exists なら 409 で返すため新規のみ／名簿は castsCol.doc() の自動 ID' },
  { file: 'src/app/store/new/page.tsx', count: 2, why: '店舗作成直後の members / device_profiles（作りたてで既存なし）' },
  { file: 'functions/src/audit.ts', count: 1, why: 'audit_logs は collection().doc() の自動 ID＝追記専用' },
  { file: 'functions/src/claim-shop.ts', count: 1, why: '申請の append（自動 ID）' },
  { file: 'functions/src/credits.ts', count: 1, why: '台帳への追記（自動 ID）' },
  { file: 'functions/src/merge.ts', count: 2, why: 'アカウント統合。どちらも targetRef/aRef の exists を見て**無いときだけ** src の doc 全体をコピー' },
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'lib') continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 呼び出しの括弧を数えて、その 1 呼び出し分のテキストを取り出す（複数行の書き込みが大半のため） */
function callText(src: string, matchIndex: number): string {
  const open = src.indexOf('(', matchIndex);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

function scan(): Map<string, number> {
  const found = new Map<string, number>();
  for (const root of ROOTS) {
    for (const file of listSourceFiles(root)) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      WRITE_CALL.lastIndex = 0;
      let n = 0;
      while ((m = WRITE_CALL.exec(src))) {
        if (!/merge:\s*true/.test(callText(src, m.index))) n++;
      }
      if (n > 0) found.set(file.split(/[\\/]/).join('/'), n);
    }
  }
  return found;
}

describe('未知キーの保持（記録エンジン 段 2）', () => {
  const found = scan();
  const allowed = new Map(GUARDED_CREATES.map((e) => [e.file, e.count]));

  it('検出ロジックが機能している（既知の書き込みを実際に拾えている）', () => {
    // ここが 0 になったら正規表現が壊れていて、以下の検査が全部素通りになる
    expect(found.size).toBeGreaterThanOrEqual(10);
    expect(found.has('functions/src/merge.ts')).toBe(true);
  });

  it('merge なしの書き込みは Map.set / res.set を拾っていない（誤検出の番人）', () => {
    // finalize-payroll は Map.set を多用するが Firestore の非 merge 書き込みは持たない
    expect(found.has('src/app/api/team/finalize-payroll/route.ts')).toBe(false);
  });

  it('merge なしで書くファイルが増えていない（新規作成であることを確認して表に追記する）', () => {
    const unlisted = [...found.keys()].filter((f) => !allowed.has(f)).sort();
    expect(unlisted).toEqual([]);
  });

  it('既知ファイル内で merge なしの書き込みが増えていない', () => {
    const changed = [...found.entries()]
      .filter(([f, n]) => allowed.has(f) && allowed.get(f) !== n)
      .map(([f, n]) => `${f}: 表は ${allowed.get(f)} 件だが実際は ${n} 件`);
    expect(changed).toEqual([]);
  });

  it('表に実在しないファイルが残っていない（削除・改名の取りこぼし検知）', () => {
    expect(GUARDED_CREATES.filter((e) => !existsSync(e.file)).map((e) => e.file)).toEqual([]);
    // 対象ファイルから非 merge 書き込みが消えたら表からも外す
    expect(GUARDED_CREATES.filter((e) => !found.has(e.file)).map((e) => e.file)).toEqual([]);
  });

  it('表のすべてに理由が書かれている（無言で許可を増やさない）', () => {
    expect(GUARDED_CREATES.filter((e) => e.why.trim().length < 10).map((e) => e.file)).toEqual([]);
  });
});
