/**
 * AI 出力から JSON を安全にパースするユーティリティ。
 *
 * Claude（Haiku/Sonnet）は system 指示で「マークダウンで囲むな」と書いても
 * \`\`\`json で囲んでくる癖がある（v2 ベンチマーク 2026-05-12 確認）。
 * このため、各 API route で「マークダウン剥がし + 部分抽出 + JSON.parse」を
 * 安全側で実行できる関数を共通化する。
 *
 * 使い方:
 *   const result = safeParseJson<MyShape>(raw);
 *   if (result) { ... }
 */

/**
 * 文字列から JSON オブジェクトを抽出してパース。
 * 失敗時は null を返す。
 *
 * 試行順序:
 *   1. そのまま JSON.parse
 *   2. マークダウンコードブロックを剥がして再試行
 *   3. 最初に見つかった `{...}` ブロックを抽出して試行
 */
export function safeParseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // 試行 1: そのまま
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fallthrough */
  }
  // 試行 2: ```json ... ``` のマークダウン剥がし
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      /* fallthrough */
    }
  }
  // 試行 3: 最初の { から最後の } を抽出
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

/**
 * AI 出力から「文字列の配列」を安全に取り出す。
 * 返信案 3 パターン等の配列出力向け。失敗時は空配列。
 *
 * DeepSeek V4 系は `["a","b"]` の代わりに `[「a」「b」]` のように
 * 全角カギ括弧で配列を作ることがある（ベンチ 2026-06-20 確認）。
 * JSON.parse が通らないため、最終手段として「」/全角引用符の中身を拾う。
 *
 * 試行順序:
 *   1. そのまま JSON.parse
 *   2. ```json フェンス剥がし
 *   3. 最初の [ から最後の ] を抽出
 *   4. 「…」/“…” で囲まれた要素を抽出
 */
export function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  const tryParse = (s: string): string[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const arr = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        if (arr.length > 0) return arr;
      }
    } catch {
      /* noop */
    }
    return null;
  };
  // 試行 1: そのまま
  let r = tryParse(trimmed);
  if (r) return r;
  // 試行 2: ```json フェンス剥がし
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fence?.[1]) {
    r = tryParse(fence[1].trim());
    if (r) return r;
  }
  // 試行 3: [ … ] を抽出
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first >= 0 && last > first) {
    r = tryParse(trimmed.slice(first, last + 1));
    if (r) return r;
  }
  // 試行 4: 全角カギ括弧 / 全角引用符の中身を拾う（JSON 崩れ対策）
  const bracketed = [...trimmed.matchAll(/[「“]([\s\S]*?)[」”]/g)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
  if (bracketed.length > 0) return bracketed;
  return [];
}
