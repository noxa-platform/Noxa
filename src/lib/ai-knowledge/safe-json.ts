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
