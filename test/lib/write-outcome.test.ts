import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APPLIED, UNCHANGED, assertWriteApplied, describeMissingWrite, missing,
} from '../../src/lib/write-outcome';
import { replaceSlipInList } from '../../src/lib/pos/store';
import type { PosSlip } from '../../src/lib/pos/engine';
import { stripComments } from '../helpers/strip-comments';

// 書き込み側の「偽の成功」（Day124）。
//
// トランザクションの中で対象 doc を読み直す実装は、対象が消えていると
// `if (!snap.exists()) return;` で**何も書かずに正常終了**する。Day117 の run() は
// 例外が出なければ成功とみなすため、画面には成功として出る。
// 実害:
//   - 会計: 別端末が先に会計した伝票をもう一度会計しても売上は増えないのに UI は伝票を閉じ、
//     両方の端末が「会計した」と思う（金額が違えば売上が食い違ったまま気づけない）
//   - 伝票操作: 会計・破棄済みの伝票への注文追加が黙って消える
//   - 卓操作: 卓 doc が消えていると配置・延長・退店が無反応のまま成功に見える

describe('assertWriteApplied（適用されたかを成功可否に反映する）', () => {
  it('適用済みは通す', () => {
    expect(() => assertWriteApplied(APPLIED)).not.toThrow();
  });

  it('★「変更なし」は成功のまま通す（回し替えの対象が1人以下 等の正常な no-op）', () => {
    expect(() => assertWriteApplied(UNCHANGED)).not.toThrow();
  });

  it('★対象が消えていたら失敗として投げる（黙って成功にしない）', () => {
    expect(() => assertWriteApplied(missing('table'))).toThrow(/卓が見つかりません/);
    expect(() => assertWriteApplied(missing('slip'))).toThrow(/伝票が見つかりません/);
  });

  it('文言は「何が起きたか」＋「次にどうするか」を含む（現場が次の行動を選べる）', () => {
    const msg = describeMissingWrite('slip');
    expect(msg).toContain('伝票が見つかりません');
    expect(msg).toContain('売上画面');
  });

  it('名前が分かるときは対象名を出す（現場は名前でしか卓を特定できない）', () => {
    expect(describeMissingWrite('table', { name: 'A1' })).toContain('卓「A1」が見つかりません');
  });

  it('会計のように次の行動が変わる場合は案内を差し替えられる', () => {
    const msg = describeMissingWrite('slip', { hint: '二重会計を防ぐため中止しました。' });
    expect(msg).toBe('伝票が見つかりません。二重会計を防ぐため中止しました。');
  });
});

// --- POS: 伝票 1 枚の差し替え ---

const slip = (id: string, name = id): PosSlip => ({ id, name, state: { orders: [] } } as unknown as PosSlip);

describe('replaceSlipInList（他端末が消した伝票への変更を黙って捨てない）', () => {
  it('対象の伝票だけ差し替える', () => {
    const out = replaceSlipInList([slip('a'), slip('b')], 'b', (s) => ({ ...s, name: '変更後' }));
    expect(out).toEqual({ slips: [slip('a'), { ...slip('b'), name: '変更後' }] });
  });

  it('★対象が一覧に無ければ missing を返す（＝注文追加が黙って消えない）', () => {
    const out = replaceSlipInList([slip('a')], 'b', (s) => s);
    expect(out).toEqual({ kind: 'missing', target: 'slip' });
  });

  it('null を返す変換は削除＝適用済み（伝票破棄は成功）', () => {
    const out = replaceSlipInList([slip('a'), slip('b')], 'a', () => null);
    expect(out).toEqual({ slips: [slip('b')] });
  });

  it('★空の伝票一覧（卓が会計直後）でも「変更なし」ではなく missing', () => {
    expect(replaceSlipInList([], 'a', (s) => s)).toEqual({ kind: 'missing', target: 'slip' });
  });
});

// --- ガード: tx 内の「無音 return」を増やさない ---

/**
 * 判定対象は**現場オペの書き込み**（会計・伝票・卓・指名）。
 * community の `deleteReply`（既に消えていれば no-op）・`report`（1人1対象=1通報に冪等化）は
 * **意図的な冪等化**で、直後に再取得した最新状態を返すため受け手から見て嘘にならない＝対象外。
 */
const TARGETS = [
  'src/lib/pos/store.ts',
  'src/lib/seating/store.ts',
  'src/lib/menu/store.ts',
  'src/components/modules/inventory/InventoryClient.tsx',
  'src/components/modules/unpaid/UnpaidClient.tsx',
];

/** `runTransaction(` の引数ブロックを丸ごと切り出す（括弧の対応で終端を探す） */
export function txBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /runTransaction\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

/**
 * tx の中で「対象が無いので何も書かずに抜ける」を、結末を残さずに書いている箇所を拾う。
 * 見ているのは**式そのもの**（import の有無ではない・Day122 の教訓）。
 * 結末を `outcome` / `missing` に記録するか `throw` しているものは正常。
 */
export function silentTxReturns(src: string): string[] {
  const out: string[] = [];
  for (const block of txBlocks(src)) {
    // 条件式は `!snap.exists()` のように括弧を1段含む（`[^)]*` だと途中の `)` で切れる）
    const re = /if\s*\((?:[^()]|\([^()]*\))*\)\s*(\{[^{}]*\}|return[^;]*;)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const stmt = m[0];
      if (!/\breturn\b/.test(stmt)) continue;      // 早期 return でなければ対象外
      if (/outcome|missing|throw/.test(stmt)) continue; // 結末を残している
      out.push(stmt.replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

describe('書き込みのガード（何も書かなかったことを成功にしない）', () => {
  const files = TARGETS.map((p) => ({ path: p, src: stripComments(readFileSync(join(process.cwd(), p), 'utf8')) }));

  it('走査対象が取れている（パス破綻の空振り防止）', () => {
    expect(files).toHaveLength(TARGETS.length);
    for (const f of files) expect(txBlocks(f.src).length).toBeGreaterThan(0);
  });

  it('★tx 内の早期 return が結末（outcome / missing / throw）を残している', () => {
    const offenders: string[] = [];
    for (const f of files) for (const hit of silentTxReturns(f.src)) offenders.push(`${f.path}: ${hit}`);
    expect(offenders).toEqual([]);
  });

  it('★ガード自身が効いている（旧実装の形を赤にできる）', () => {
    const old = `await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      tx.set(ref, patch);
    });`;
    const fixed = `await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) { outcome = missing('table'); return; }
      tx.set(ref, patch);
    });`;
    const thrown = `await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('卓が見つかりません');
      tx.set(ref, patch);
    });`;
    expect(silentTxReturns(old)).toHaveLength(1);
    expect(silentTxReturns(fixed)).toHaveLength(0);
    expect(silentTxReturns(thrown)).toHaveLength(0);
  });

  it('★一部回収はサーバ最新値に足す（画面キャッシュ由来の絶対値で上書きしない）', () => {
    // 旧実装は `collectPatch(r, add)`（r = 画面のレコード）から作った paidAmount を updateDoc で
    // 書いていたため、別端末が先に入れた回収が**黙って消えて残高が戻る**（Day124 バグハント）。
    const src = stripComments(readFileSync(join(process.cwd(), 'src/components/modules/unpaid/UnpaidClient.tsx'), 'utf8'));
    const start = src.indexOf('const applyCollect');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  };', start));
    expect(body).toContain('runTransaction');
    expect(body).not.toMatch(/updateDoc\(/);        // 絶対値の直接書き込みをしない
    expect(body).toMatch(/collectPatch\(\s*\{/);    // tx 内で読んだ最新値から組む
  });

  it('★コメントを実装と誤検知しない（Day121-PM / Day123 と同じ穴を開けない）', () => {
    const commented = `await runTransaction(db, async (tx) => {
      // 旧実装: if (!snap.exists()) return; と書いて黙って抜けていた
      if (!snap.exists()) { outcome = missing('table'); return; }
    });`;
    expect(silentTxReturns(stripComments(commented))).toHaveLength(0);
  });
});
