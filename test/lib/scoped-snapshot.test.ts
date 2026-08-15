import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { valueForScope, errorForScope } from '../../src/lib/scoped-snapshot';
import { stripComments } from '../helpers/strip-comments';

// 「出所つきスナップショット」（Day123）。
//
// `useEffect([shopId])` の購読で `if (snap.exists()) setX(...)` とだけ書くと、
// **新しい出所に doc が無い間・読み込みが終わるまでの間、前の出所の値が画面に残る**。
// 実害:
//   - 席回し: 店舗を切り替えても料金設定が前の店のままで、卓合計が別店舗の料金で出る
//   - 予約: 同型。しかも来店処理は伝票を**永続化**するので、別店舗の料金の伝票が売上まで流れる
//   - プラン: `getDoc` に catch が無く、失敗しても sub は null のまま＝**課金済みでも「Noxa Free」**

const DEFAULT = { price: 0 };
const LOADED = { price: 5000 };

describe('valueForScope（別の出所の値を使い回さない）', () => {
  it('出所が一致するときだけスナップショットの値を使う', () => {
    expect(valueForScope({ scope: 's1', value: LOADED }, 's1', DEFAULT)).toBe(LOADED);
  });

  it('★出所が変わったら既定に戻す（前の店の料金設定を持ち越さない）', () => {
    expect(valueForScope({ scope: 's1', value: LOADED }, 's2', DEFAULT)).toBe(DEFAULT);
  });

  it('未取得（null）は既定', () => {
    expect(valueForScope(null, 's1', DEFAULT)).toBe(DEFAULT);
    expect(valueForScope(undefined, 's1', DEFAULT)).toBe(DEFAULT);
  });

  it('★出所そのものが未確定（null）なら既定（前の店舗のまま表示しない）', () => {
    expect(valueForScope({ scope: 's1', value: LOADED }, null, DEFAULT)).toBe(DEFAULT);
    expect(valueForScope({ scope: 's1', value: LOADED }, undefined, DEFAULT)).toBe(DEFAULT);
  });
});

describe('errorForScope（前の出所の失敗を引きずらない）', () => {
  it('同じ出所の失敗は返す', () => {
    expect(errorForScope({ scope: 'u1', value: '読み込めませんでした' }, 'u1')).toBe('読み込めませんでした');
  });

  it('別の出所の失敗は出さない（切り替えた先の画面に他店のエラーを出さない）', () => {
    expect(errorForScope({ scope: 'u1', value: '読み込めませんでした' }, 'u2')).toBeNull();
  });
});

// --- ガード: 「exists のときだけ set して初期化しない」形を増やさない ---

const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// 判定はコードだけに当てる（注意書きのコメントを実装として摘発しない・Day121-PM の同型）
const FILES = files(SRC).map((p) => ({
  path: relative(process.cwd(), p).split(/[\\/]/).join('/'),
  src: stripComments(readFileSync(p, 'utf8')),
}));

/**
 * `if (snap.exists()) setX(...)` の形（else も三項も無い）を拾う。
 * この書き方は「doc が無い＝前の値のまま」になり、出所が変わると別物を表示する。
 */
function existsOnlySetters(src: string): string[] {
  const out: string[] = [];
  const re = /if \((\w+)\.exists\(\)\)\s*(\{[^\n]*\}|set[A-Z]\w*\([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const line = m[0];
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/^\s*else\b/.test(after)) continue; // else で初期化しているならよい
    out.push(line.split('\n')[0].trim());
  }
  return out;
}

describe('doc 購読のガード（出所が変わったら前の値を残さない）', () => {
  it('走査対象が取れている（グロブ破綻の空振り防止）', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('★`if (x.exists()) setX(...)` を書きっぱなしにしない（else か出所つきで持つ）', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const hit of existsOnlySetters(f.src)) offenders.push(`${f.path}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('★ガード自身が効いている（旧実装の形を赤にできる）', () => {
    const old = 'onSnapshot(ref, (snap) => {\n  if (snap.exists()) setConfig(snap.data());\n});\n';
    const withElse = 'if (snap.exists()) setConfig(snap.data());\nelse setConfig(DEFAULT);\n';
    expect(existsOnlySetters(old)).toHaveLength(1);
    expect(existsOnlySetters(withElse)).toHaveLength(0);
  });
});
