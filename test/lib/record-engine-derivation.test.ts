import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseExpr, evaluateExpr, makeFieldLookup, sumOver, applyDerivations, derivationsToXPatch,
  MAX_EXPR_DEPTH, MAX_EXPR_NODES, MAX_SUM_ROWS,
  type Expr,
} from '@/lib/record-engine/derivation';

// 記録エンジン段 6（P150）。
//
// **共有テストケース表（`derivation-cases.json`）を実際に読んで回す**のがこのファイルの主目的。
// 同じ表を yorulog-ios 側の簡易評価にも通させる約束なので、**表を変えたら両側が落ちる**。
// 表に無い境界（上限・不正な式の形）だけ、こちらで追加で固定する。

const CASES = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/record-engine/derivation-cases.json'), 'utf8'),
) as {
  version: number;
  cases: { name: string; record: Record<string, unknown>; expr: unknown; expected: { value: number | null } }[];
  invalidExprs: { name: string; expr: unknown }[];
  sumCases: {
    name: string; rows: Record<string, unknown>[]; expr: unknown;
    expected: { value: number; counted: number; skipped: number; truncated: boolean };
  }[];
};

describe('共有テストケース表（iOS と同じ表を通す）', () => {
  it('表が空でない（読み込みが壊れたら気づけるように）', () => {
    expect(CASES.version).toBe(1);
    expect(CASES.cases.length).toBeGreaterThan(15);
    expect(CASES.invalidExprs.length).toBeGreaterThan(5);
    expect(CASES.sumCases.length).toBeGreaterThan(0);
  });

  it.each(CASES.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = parseExpr(c.expr);
    expect(parsed.ok, `式が検証を通らない: ${JSON.stringify(c.expr)}`).toBe(true);
    if (!parsed.ok) return;
    const r = evaluateExpr(parsed.parsed.expr, makeFieldLookup(c.record));
    expect(r.value).toBe(c.expected.value);
    // null なら理由が必ず付く（画面に「なぜ出せないか」を出せるように）
    if (r.value === null) expect(r.reason, '理由の無い null は返さない').toBeTruthy();
  });

  it.each(CASES.invalidExprs.map((c) => [c.name, c] as const))('不正な式: %s', (_name, c) => {
    const parsed = parseExpr(c.expr);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.reason).toBeTruthy();
  });

  it.each(CASES.sumCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = parseExpr(c.expr);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(sumOver(c.rows, parsed.parsed.expr)).toEqual(c.expected);
  });
});

describe('式は信用しない（段 7 で AI が生成する）', () => {
  const nest = (n: number): unknown => {
    let e: unknown = { lit: 1 };
    for (let i = 0; i < n; i++) e = { op: '+', args: [e, { lit: 1 }] };
    return e;
  };

  it(`深さ ${MAX_EXPR_DEPTH} 段までは通る`, () => {
    expect(parseExpr(nest(MAX_EXPR_DEPTH - 1)).ok).toBe(true);
  });

  it('深すぎる式は拒否する', () => {
    const r = parseExpr(nest(MAX_EXPR_DEPTH + 5));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toContain('深すぎ');
  });

  it('ノード数が多すぎる式は拒否する', () => {
    // 浅いが横に広い式（深さ制限をすり抜ける形）
    let e: unknown = { lit: 1 };
    for (let i = 0; i < MAX_EXPR_NODES; i++) e = { coalesce: [{ lit: 1 }, e] };
    const r = parseExpr(e);
    expect(r.ok).toBe(false);
  });

  it('エラーには式のどこで落ちたかが入る', () => {
    const r = parseExpr({ op: '+', args: [{ lit: 1 }, { op: '%', args: [{ lit: 1 }, { lit: 2 }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe('root.args[1].op');
  });

  it('検証を通った式は必ず評価できる（例外を投げない）', () => {
    for (const c of CASES.cases) {
      const p = parseExpr(c.expr);
      if (!p.ok) continue;
      expect(() => evaluateExpr(p.parsed.expr, () => undefined)).not.toThrow();
    }
  });
});

describe('makeFieldLookup', () => {
  it('x が壊れていても固定項目は読める', () => {
    for (const x of ['ごみ', 42, [1], null]) {
      const lookup = makeFieldLookup({ salesAmount: 100, x });
      expect(lookup('salesAmount'), JSON.stringify(x)).toBe(100);
    }
  });
});

describe('sumOver — 計算できない行を 0 として足さない', () => {
  const expr: Expr = { field: 'a' };

  // 0 として足すと「その行の売上は 0 円だった」という意味になり、平均も割合も狂う
  it('飛ばした件数を返す（黙って落とさない）', () => {
    const r = sumOver([{ x: { a: 5 } }, { x: { a: 'x' } }], expr);
    expect(r).toEqual({ value: 5, counted: 1, skipped: 1, truncated: false });
  });

  it(`${MAX_SUM_ROWS} 行で打ち切り、打ち切ったことを返す`, () => {
    const rows = Array.from({ length: MAX_SUM_ROWS + 10 }, () => ({ x: { a: 1 } }));
    const r = sumOver(rows, expr);
    expect(r.counted).toBe(MAX_SUM_ROWS);
    expect(r.truncated).toBe(true);
  });

  it('空の入力は 0 件（truncated は false）', () => {
    expect(sumOver([], expr)).toEqual({ value: 0, counted: 0, skipped: 0, truncated: false });
  });

  it('途中で桁あふれした行は飛ばし、合計を壊さない', () => {
    const r = sumOver([{ x: { a: 1e308 } }, { x: { a: 1e308 } }, { x: { a: 5 } }], expr);
    expect(Number.isFinite(r.value)).toBe(true);
    expect(r.skipped).toBe(1);
  });
});

describe('applyDerivations — 記録そのものは書き換えない', () => {
  const derivations = [
    { key: 'bottle_sales', label: 'ボトル売上', expr: { op: '*', args: [{ field: 'unit_price' }, { field: 'bottle_count' }] } as Expr },
    { key: 'missing_one', label: '出せないもの', expr: { field: 'nope' } as Expr },
  ];

  it('計算できたものと、できなかった理由を分けて返す', () => {
    const record = { x: { unit_price: 8000, bottle_count: 3 } };
    const { values, reasons } = applyDerivations(record, derivations);
    expect(values.bottle_sales).toBe(24000);
    expect(values.missing_one).toBeNull();
    expect(reasons.missing_one).toContain('nope');
    // 入力を書き換えていないこと
    expect(record).toEqual({ x: { unit_price: 8000, bottle_count: 3 } });
  });

  it('x へ書き戻す前に記録側の縛りを通す（null は保持・不正キーは落ちる）', () => {
    const patch = derivationsToXPatch({ bottle_sales: 24000, missing_one: null, 'ボトル': 1 });
    expect(patch).toEqual({ bottle_sales: 24000, missing_one: null });
  });
});
