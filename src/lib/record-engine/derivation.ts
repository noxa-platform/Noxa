// 記録エンジン段 6: 導出（derivations）— P150。
//
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §2.4。
//
// 「売上の付け方」が各画面の個別計算になっていて**ユーザーがルールを変えられない**、が
// 今回の要望の本体。式を**データ**にして、コードを触らずに変えられるようにする。
//
// ## 決定（2026-08-25・yorulog と合意）
//
// - **評価はサーバが正本。クライアントは表示のみ。** 同じ判定を 2 箇所に書くと必ずズレる
//   （yorulog が P100 でまさに踏んだ）。ズレを検出するため、**テストケース表を JSON で共有**し、
//   両側が同じ表を通す（`derivation-cases.json`）。
// - 式は**四則 + 比較 + 条件分岐 + 合計**に閉じる。式言語を作り込むと、両側に評価器の
//   実装が要る。閉じておけば移植が逐語でできる。
//
// ## 「分からない」を 0 にしない（この設計の芯）
//
// 項目が無い・0 除算・非有限——どれも**結果を `null`（分からない）にして伝播させる**。
// 0 に倒すと「売上ゼロ」という**意味のある値**に化け、集計に混ざったまま気づけない。
// `null` なら「まだ計算できない」と表示でき、合計からは除ける。
//
// ## 式は信用しない
//
// 段 7 で**式は AI が生成する**。深さ・ノード数・演算子を検証で縛り、評価は
// 有限ステップで必ず終わる形にする（ループも関数定義も持たない）。
import { validateXMap } from './record-schema';

/** 式の入れ子の上限。人が読める式の範囲を超えたら、それは式ではなくプログラム */
export const MAX_EXPR_DEPTH = 12;
/** 式のノード数の上限。AI 生成物が青天井に膨らむのを防ぐ */
export const MAX_EXPR_NODES = 200;
/** 合計に流せる行数の上限。1 回の導出で全期間を舐めさせない */
export const MAX_SUM_ROWS = 5000;

export type CompareOp = '>' | '>=' | '<' | '<=' | '==' | '!=';
export type ArithOp = '+' | '-' | '*' | '/';

export type Expr =
  /** 定数 */
  | { lit: number }
  /** 項目の値。`x` の項目と固定項目のどちらも同じ書き方で読む */
  | { field: string }
  /** 四則 */
  | { op: ArithOp; args: [Expr, Expr] }
  /** 比較。真偽は 1 / 0 で返す（型を増やさない） */
  | { cmp: CompareOp; args: [Expr, Expr] }
  /** 条件分岐。`cond` が 0 以外なら `then`、0 なら `else` */
  | { if: Expr; then: Expr; else: Expr }
  /** 値が無いときの既定値。**ここでだけ明示的に 0 へ倒せる** */
  | { coalesce: [Expr, Expr] };

export interface ParsedExpr {
  expr: Expr;
  nodes: number;
  depth: number;
}

export interface ExprError {
  /** 式のどこで落ちたか。`root.args[0].if` のような道順 */
  path: string;
  reason: string;
}

// ── 検証 ─────────────────────────────────────────────

/**
 * 式を検証する。**未知の形は受け入れない**——記録の値（§1.6）と違い、式は
 * 「知らないものを保持して後で意味を与える」対象ではない。知らない演算子を保持しても
 * 評価できず、**評価できない式を保存すると壊れた導出が黙って居座る**。
 */
export function parseExpr(raw: unknown): { ok: true; parsed: ParsedExpr } | { ok: false; error: ExprError } {
  let nodes = 0;
  let maxDepth = 0;

  const walk = (node: unknown, path: string, depth: number): Expr | ExprError => {
    if (depth > MAX_EXPR_DEPTH) return { path, reason: `式が深すぎます（${MAX_EXPR_DEPTH} 段まで）` };
    maxDepth = Math.max(maxDepth, depth);
    if (++nodes > MAX_EXPR_NODES) return { path, reason: `式が大きすぎます（${MAX_EXPR_NODES} 要素まで）` };
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return { path, reason: '式の形が不正です' };
    }
    const o = node as Record<string, unknown>;

    if ('lit' in o) {
      // 非有限の定数を許すと、そこから先の計算が全部 NaN になる（P149 と同じ理由）
      if (typeof o.lit !== 'number' || !Number.isFinite(o.lit)) {
        return { path: `${path}.lit`, reason: '定数が有限の数値ではありません' };
      }
      return { lit: o.lit };
    }

    if ('field' in o) {
      if (typeof o.field !== 'string' || !o.field.trim()) {
        return { path: `${path}.field`, reason: '項目名が空です' };
      }
      return { field: o.field.trim() };
    }

    if ('op' in o) {
      const op = o.op;
      if (op !== '+' && op !== '-' && op !== '*' && op !== '/') {
        return { path: `${path}.op`, reason: `知らない演算子です: ${String(op)}` };
      }
      const args = pair(o.args, `${path}.args`);
      if ('reason' in args) return args;
      const a = walk(args.value[0], `${path}.args[0]`, depth + 1);
      if (isErr(a)) return a;
      const b = walk(args.value[1], `${path}.args[1]`, depth + 1);
      if (isErr(b)) return b;
      return { op, args: [a, b] };
    }

    if ('cmp' in o) {
      const cmp = o.cmp;
      if (!['>', '>=', '<', '<=', '==', '!='].includes(cmp as string)) {
        return { path: `${path}.cmp`, reason: `知らない比較です: ${String(cmp)}` };
      }
      const args = pair(o.args, `${path}.args`);
      if ('reason' in args) return args;
      const a = walk(args.value[0], `${path}.args[0]`, depth + 1);
      if (isErr(a)) return a;
      const b = walk(args.value[1], `${path}.args[1]`, depth + 1);
      if (isErr(b)) return b;
      return { cmp: cmp as CompareOp, args: [a, b] };
    }

    if ('if' in o) {
      const cond = walk(o.if, `${path}.if`, depth + 1);
      if (isErr(cond)) return cond;
      const t = walk(o.then, `${path}.then`, depth + 1);
      if (isErr(t)) return t;
      const e = walk(o.else, `${path}.else`, depth + 1);
      if (isErr(e)) return e;
      return { if: cond, then: t, else: e };
    }

    if ('coalesce' in o) {
      const args = pair(o.coalesce, `${path}.coalesce`);
      if ('reason' in args) return args;
      const a = walk(args.value[0], `${path}.coalesce[0]`, depth + 1);
      if (isErr(a)) return a;
      const b = walk(args.value[1], `${path}.coalesce[1]`, depth + 1);
      if (isErr(b)) return b;
      return { coalesce: [a, b] };
    }

    return { path, reason: '知らない式です' };
  };

  const result = walk(raw, 'root', 1);
  if (isErr(result)) return { ok: false, error: result };
  return { ok: true, parsed: { expr: result, nodes, depth: maxDepth } };
}

function pair(raw: unknown, path: string): { value: [unknown, unknown] } | ExprError {
  if (!Array.isArray(raw) || raw.length !== 2) return { path, reason: '引数は 2 つ必要です' };
  return { value: [raw[0], raw[1]] };
}

function isErr(v: unknown): v is ExprError {
  return !!v && typeof v === 'object' && 'reason' in (v as Record<string, unknown>);
}

// ── 評価 ─────────────────────────────────────────────

export interface EvalResult {
  /** 計算できなければ `null`。**0 に倒さない** */
  value: number | null;
  /** `null` になった理由。画面に「なぜ出せないか」を出せるようにする */
  reason?: string;
}

/** 記録 1 件を、固定項目と `x` をまとめて引ける形にする */
export function makeFieldLookup(record: Record<string, unknown>): (key: string) => unknown {
  const x = (record.x && typeof record.x === 'object' && !Array.isArray(record.x))
    ? (record.x as Record<string, unknown>)
    : {};
  return (key: string) => {
    // `x` を先に見る。固定項目と同名の自由項目が作られても、**記録に書かれた方**を使う
    if (key in x) return x[key];
    return record[key];
  };
}

/**
 * 式を 1 件分評価する。**必ず有限ステップで終わる**（ループも関数もない）。
 *
 * 値が取れないときは `null` を伝播させる。`coalesce` を書いたところでだけ 0 等へ倒せる——
 * 「分からない」を勝手に 0 にしないためで、倒すかどうかは**式を書いた人の宣言**にする。
 */
export function evaluateExpr(expr: Expr, lookup: (key: string) => unknown): EvalResult {
  if ('lit' in expr) return { value: expr.lit };

  if ('field' in expr) {
    const raw = lookup(expr.field);
    if (raw === null || raw === undefined) return { value: null, reason: `項目「${expr.field}」がありません` };
    if (typeof raw === 'boolean') return { value: raw ? 1 : 0 };
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return { value: null, reason: `項目「${expr.field}」が有限の数値ではありません` };
      return { value: raw };
    }
    // 文字列・配列・マップは数として扱わない。**数値に見える文字列も変換しない**——
    // "1,000" や "3千" を勝手に解釈すると、間違った金額が黙って集計に乗る
    return { value: null, reason: `項目「${expr.field}」は数値ではありません` };
  }

  if ('op' in expr) {
    const a = evaluateExpr(expr.args[0], lookup);
    if (a.value === null) return a;
    const b = evaluateExpr(expr.args[1], lookup);
    if (b.value === null) return b;
    switch (expr.op) {
      case '+': return finite(a.value + b.value);
      case '-': return finite(a.value - b.value);
      case '*': return finite(a.value * b.value);
      case '/':
        // **0 除算は Infinity にしない。** 通すと合計が壊れ、しかも画面には数字が出る
        if (b.value === 0) return { value: null, reason: '0 で割ろうとしました' };
        return finite(a.value / b.value);
    }
  }

  if ('cmp' in expr) {
    const a = evaluateExpr(expr.args[0], lookup);
    if (a.value === null) return a;
    const b = evaluateExpr(expr.args[1], lookup);
    if (b.value === null) return b;
    const r = (() => {
      switch (expr.cmp) {
        case '>': return a.value! > b.value!;
        case '>=': return a.value! >= b.value!;
        case '<': return a.value! < b.value!;
        case '<=': return a.value! <= b.value!;
        case '==': return a.value === b.value;
        case '!=': return a.value !== b.value;
      }
    })();
    return { value: r ? 1 : 0 };
  }

  if ('if' in expr) {
    const cond = evaluateExpr(expr.if, lookup);
    // 条件が分からないなら結果も分からない。**どちらかの枝を選ばない**
    if (cond.value === null) return cond;
    return evaluateExpr(cond.value !== 0 ? expr.then : expr.else, lookup);
  }

  // coalesce: 左が計算できなければ右。**ここが「分からない」を倒せる唯一の場所**
  const first = evaluateExpr(expr.coalesce[0], lookup);
  if (first.value !== null) return first;
  return evaluateExpr(expr.coalesce[1], lookup);
}

function finite(n: number): EvalResult {
  // 桁あふれ（1e308 * 10 等）は Infinity になる。ここで止めないと合計が壊れる
  if (!Number.isFinite(n)) return { value: null, reason: '計算結果が有限ではありません' };
  return { value: n };
}

// ── 合計 ─────────────────────────────────────────────

export interface SumResult {
  value: number;
  /** 足せた件数 */
  counted: number;
  /** 計算できず飛ばした件数。**0 として足さない** */
  skipped: number;
  /** 上限で打ち切ったか。**黙って切り捨てない** */
  truncated: boolean;
}

/**
 * 行ごとに式を評価して合計する。
 * **計算できない行は 0 として足さず、飛ばして件数で返す。**
 * 0 として足すと「その行の売上は 0 円だった」という意味になり、平均も割合も狂う。
 */
export function sumOver(rows: Record<string, unknown>[], expr: Expr): SumResult {
  let value = 0;
  let counted = 0;
  let skipped = 0;
  const limit = Math.min(rows.length, MAX_SUM_ROWS);
  for (let i = 0; i < limit; i++) {
    const r = evaluateExpr(expr, makeFieldLookup(rows[i]));
    if (r.value === null) { skipped++; continue; }
    const next = value + r.value;
    if (!Number.isFinite(next)) { skipped++; continue; }
    value = next;
    counted++;
  }
  return { value, counted, skipped, truncated: rows.length > limit };
}

/**
 * 導出の定義。**保存前に必ず `parseExpr` を通す**（壊れた式を保存させない）。
 */
export interface Derivation {
  key: string;
  label: string;
  expr: Expr;
}

/** 記録 1 件に導出を適用して、`x` と同じ形の追加値を作る。**記録そのものは書き換えない** */
export function applyDerivations(
  record: Record<string, unknown>,
  derivations: Derivation[],
): { values: Record<string, number | null>; reasons: Record<string, string> } {
  const lookup = makeFieldLookup(record);
  const values: Record<string, number | null> = {};
  const reasons: Record<string, string> = {};
  for (const d of derivations) {
    const r = evaluateExpr(d.expr, lookup);
    values[d.key] = r.value;
    if (r.value === null && r.reason) reasons[d.key] = r.reason;
  }
  return { values, reasons };
}

/** 導出の結果を `x` へ書き戻す前に、記録側の縛りを通す（キー名・件数・非有限） */
export function derivationsToXPatch(values: Record<string, number | null>): Record<string, unknown> {
  return validateXMap(values).x;
}
