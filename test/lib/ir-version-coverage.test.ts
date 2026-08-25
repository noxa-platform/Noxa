import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// 記録の版（`ir_version`）の網羅ガード — 記録エンジン共通仕様 段 3（P145）。
//
// P137〜P138 で `stampIrVersion` を入れたが、**適用先は手で書いた一覧**だった。
// この形は「新しい記録の作成点を足したときに刻み忘れても誰も気づかない」——
// PII マスク（Day99）と injection ガード（P130）で 2 回起きたのと同じ形の穴で、
// しかも `ir_version` は**後から一括で付け直せない**（欠落は v0 と読む決まりで、
// 遡って書き換える移行はやらない。仕様 §1.7）。＝ 刻み忘れは永久に残る。
//
// そこで src 全体を静的に走査して Firestore の**新規作成書込**を全数拾い、
//   - 版を刻んでいる（`stampIrVersion(`）
//   - または EXEMPT に**理由付きで**載っている
// のどちらかであることを強制する。新しい作成点が増えたら未分類で赤くなる。
//
// 「更新」は対象外（`merge: true` を含む書込は最初から拾わない）。版を更新で刻むと
// 一番古いクライアントの版が最後に残る＝版の巻き戻りになるため（仕様 §1.7）。

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/**
 * 版を刻まない新規作成書込。**理由を必ず書く**（書けないなら刻む方が正しい）。
 * `marker` は当該呼び出しの引数に現れる目印。ここが実体と合わなくなると
 * 「棚卸しが古い」としてこのテストが落ちる（消し忘れの除外が残らない）。
 */
const EXEMPT: { file: string; marker: string; reason: string }[] = [
  // ── doc 全体の引っ越し: 元の版をそのまま運ぶのが正しい ──
  {
    file: 'src/lib/handle.ts',
    marker: 'handle: newH',
    reason:
      'ハンドル変更は profile_pages の doc の引っ越し。元の版を運ぶのが正しく、'
      + '欠落している古い doc に現在の版を刻むと「いつの形か」を偽ることになる（遡って付けない・§1.7）',
  },
  {
    file: 'src/app/api/team/assign-customer/route.ts',
    marker: 'd.data()',
    reason: '担当移管は台帳 doc の丸ごとコピー。元の版を運ぶ（上と同じ理由）',
  },

  // ── 既存 doc の全置換（＝更新。merge を使っていないだけ） ──
  {
    file: 'src/lib/seating/store.ts',
    marker: 'slips: [], updatedAt: serverTimestamp()',
    reason:
      '卓のリセット。既存の卓 doc を白紙化する更新であって作成ではない'
      + '（merge にしないのは castStartTimes 等の ghost キーを残さないため）',
  },
  {
    file: 'src/lib/seating/store.ts',
    marker: 'innerRotationEnabled: t.innerRotationEnabled',
    reason: '退店処理の白紙化。既存の卓 doc の全置換＝更新（同上）',
  },

  // ── 設定・スキーマ側（記録ではない。§1.7 で版の扱いが別と決まっている） ──
  {
    file: 'src/lib/pos/store.ts',
    marker: '...seed, updatedAt',
    reason: 'POS 料金設定の初期値。記録ではなく設定（スキーマ側は「書くたびに上げる」別規則）',
  },
  {
    file: 'src/app/store/new/page.tsx',
    marker: 'allowedModules',
    reason: '端末プロファイルは設定（同上）',
  },
  {
    file: 'src/lib/menu/store.ts',
    marker: 'dataUrl',
    reason: 'メニュー画像の実体。記録ではなく添付データ',
  },

  // ── noxa 内部の運用データ（4 プロダクトで共有する記録ではない） ──
  {
    file: 'src/app/api/lib/audit.ts',
    marker: 'actor:',
    reason: '管理操作の監査証跡。noxa の内部ログで、他プロダクトが読み書きしない',
  },
  {
    file: 'src/app/api/community/redeem-invite/route.ts',
    marker: "kind: 'invite_used'",
    reason: '通知の配送キュー。読まれたら消える運用データで記録ではない',
  },
  {
    file: 'src/app/api/ai/feedback/route.ts',
    marker: 'feedbackPayload',
    reason: 'AI の良し悪しフィードバック。noxa 内部の学習データ',
  },
  {
    file: 'src/app/api/ai/feedback/route.ts',
    marker: 'sanitizedOutput',
    reason: 'AI 学習パターンの内部エントリ（同上）',
  },
];

// ── 走査 ──────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `(` から対応する `)` までを返す */
function argsOf(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

const CALL = /(?:\baddDoc\(|\bsetDoc\(|([A-Za-z0-9_$.`'"/${}[\]()\s-]{1,200}?)\.(?:set|add|create)\()/g;

/**
 * Firestore の書込に見える受け側か。`Map.set` / `URLSearchParams.set` /
 * `cookies.set` を拾わないよう、**末尾の語**で判定する
 * （`byColor` のような語を「col を含む」で拾うと誤検出になる）。
 */
function isFirestoreReceiver(recv: string): boolean {
  // 受け側は行頭から貪欲に拾われるため、**末尾**だけを見る
  const r = recv.trimEnd();
  if (/(?:^|[^\w$])(?:tx|t|db|batch)$/.test(r)) return true;
  if (/\.(?:doc|collection)\([^()]*\)$/.test(r)) return true;
  return /[A-Za-z0-9_$]*(?:Ref|Col)$/.test(r) || /(?:^|[^\w$])ref$/.test(r);
}

type Site = { file: string; line: number; args: string; stamped: boolean };

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const abs of walk(SRC)) {
    const src = readFileSync(abs, 'utf8');
    // 変数経由で版を刻んでいる場合（`const payload = stampIrVersion({...})` を
    // 別行で `.set(ref, payload)` する形）を拾うための対応表
    const stampedVars = new Set(
      [...src.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)(?::[^=]+)?\s*=\s*stampIrVersion\(/g)].map((m) => m[1]),
    );
    for (const m of src.matchAll(CALL)) {
      const open = src.indexOf('(', m.index! + m[0].length - 1);
      if (open < 0) continue;
      const args = argsOf(src, open);
      const isClientApi = m[0].startsWith('addDoc(') || m[0].startsWith('setDoc(');
      if (!isClientApi && !isFirestoreReceiver(m[1] ?? '')) continue;
      if (/merge:\s*true/.test(args)) continue; // 更新（版は触らない）
      const stamped =
        args.includes('stampIrVersion(')
        || [...stampedVars].some((v) => new RegExp(`(?:^|[^\\w$])${v}(?:[^\\w$]|$)`).test(args));
      sites.push({
        file: relative(ROOT, abs).replace(/\\/g, '/'),
        line: src.slice(0, m.index!).split('\n').length,
        args,
        stamped,
      });
    }
  }
  return sites;
}

const sites = collectSites();

describe('ir_version の網羅ガード（新規作成の刻み忘れを落とす）', () => {
  it('走査が壊れていない（作成書込を実際に拾えている）', () => {
    // 実装を消したり正規表現を壊したりすると 0 件になって全部素通りするため、下限を置く
    expect(sites.length).toBeGreaterThan(40);
    expect(sites.filter((s) => s.stamped).length).toBeGreaterThan(30);
  });

  it('版を刻まない新規作成書込は EXEMPT に理由付きで載っている', () => {
    const unstamped = sites.filter((s) => !s.stamped);
    const unclassified = unstamped
      .filter((s) => !EXEMPT.some((e) => e.file === s.file && s.args.includes(e.marker)))
      .map((s) => `${s.file}:${s.line} ${s.args.replace(/\s+/g, ' ').slice(0, 80)}`);
    // 新しい記録の作成点を足したら、ここで名指しで落ちる。
    // 刻むか、EXEMPT に**理由を書いて**載せるかを選ぶこと。
    expect(unclassified).toEqual([]);
  });

  it('EXEMPT に消し忘れが無い（実体の無い除外を残さない）', () => {
    const stale = EXEMPT.filter(
      (e) => !sites.some((s) => !s.stamped && s.file === e.file && s.args.includes(e.marker)),
    ).map((e) => `${e.file} :: ${e.marker}`);
    expect(stale).toEqual([]);
  });

  it('EXEMPT の理由が空でない', () => {
    for (const e of EXEMPT) expect(e.reason.length).toBeGreaterThan(10);
  });

  it('版を刻んだ書込に merge: true が混ざっていない（更新で刻むと版が巻き戻る）', () => {
    // collectSites は merge を除外済みなので、ここは全走査で二重に見張る
    const offenders: string[] = [];
    for (const abs of walk(SRC)) {
      const src = readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/stampIrVersion\(/g)) {
        const open = src.indexOf('(', m.index!);
        if (/merge:\s*true/.test(argsOf(src, open))) {
          offenders.push(`${relative(ROOT, abs)}:${src.slice(0, m.index!).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
