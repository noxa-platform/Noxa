// OpenRouter のモデル表（純粋データ・サーバ/クライアント共用）。
//
// ⚠️ **ここが単価の正本**。原価の話をするコード（`src/lib/ai-cost.ts` のクレジット設計、
// `/api/ai/benchmark` のコスト概算）は全部この表を見る。以前は ai-cost.ts のコメントに
// 単価が直書きされていて、表を更新しても誰も直さないため**失効した数字が残っていた**（P153 ④）。
//
// openrouter.ts（fetch を持つサーバ専用モジュール）から切り出したのは、
// クライアントにも配られる ai-cost.ts が安全に import できるようにするため。
// 2026-08-25 P153 で新設。

/**
 * 推奨モデルリスト。クライアント側のセレクター UI で使う。
 * id は OpenRouter のモデル ID（"provider/model" 形式）。
 * cost は概算（USD/M tokens）、UI 表示とコスト概算用。
 */
export interface OpenRouterModelMeta {
  id: string;
  label: string;
  provider: string;
  /** 概算 USD per 1M input tokens */
  inputCostUsdPerM: number;
  /** 概算 USD per 1M output tokens */
  outputCostUsdPerM: number;
  /** UI バッジ用ヒント */
  hint?: string;
}

export const OPENROUTER_MODELS: OpenRouterModelMeta[] = [
  // ⚠️ **単価は OpenRouter の公開 API（https://openrouter.ai/api/v1/models）で 2026-08-25 に実測した値**。
  // それ以前は 2026-05-12 の値のまま放置され、19 行中 6 行がズレていた
  // （例: deepseek-chat-v3.1 は $0.21/$0.79 → 実際は $0.55/$1.65 で **2.6 倍**、
  //  kimi-k2.6 は $0.74/$3.50 → $0.95/$4.00）。原価の議論がこの表を土台にしている以上、
  //  古い値は「安いつもりで高いモデルを回す」に直結する。
  // ⚠️ OpenRouter は価格を随時改定する。`node scripts/check-model-prices.mjs` で差分を出せる（P153 ④）。
  // 並びは input 単価の安い順。
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'DeepSeek', inputCostUsdPerM: 0.0854, outputCostUsdPerM: 0.1708, hint: '最新・1M context・コスパ最強' },
  { id: 'qwen/qwen3-235b-a22b-2507', label: 'Qwen3 235B (2507)', provider: 'Alibaba', inputCostUsdPerM: 0.09, outputCostUsdPerM: 0.55, hint: '激安・大モデル' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'Google', inputCostUsdPerM: 0.1, outputCostUsdPerM: 0.4, hint: '激安・短文向け' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'OpenAI', inputCostUsdPerM: 0.2, outputCostUsdPerM: 1.2, hint: '本番 THINK 候補・安い' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 mini', provider: 'OpenAI', inputCostUsdPerM: 0.25, outputCostUsdPerM: 2, hint: 'OpenAI 軽量' },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', provider: 'Google', inputCostUsdPerM: 0.25, outputCostUsdPerM: 1.5, hint: '本番 FAST 候補・安い' },
  { id: 'deepseek/deepseek-v3.2-exp', label: 'DeepSeek V3.2 exp', provider: 'DeepSeek', inputCostUsdPerM: 0.27, outputCostUsdPerM: 0.41, hint: '実験版・日本語強い' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', inputCostUsdPerM: 0.3, outputCostUsdPerM: 2.5, hint: '汎用・低コスト' },
  { id: 'deepseek/deepseek-r1-0528', label: 'DeepSeek R1 (0528)', provider: 'DeepSeek', inputCostUsdPerM: 0.5, outputCostUsdPerM: 2.15, hint: '推論型・新版' },
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1', provider: 'DeepSeek', inputCostUsdPerM: 0.55, outputCostUsdPerM: 1.65, hint: '安定版' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'DeepSeek', inputCostUsdPerM: 0.579072, outputCostUsdPerM: 1.158144, hint: '最新 Pro・1M context' },
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot', inputCostUsdPerM: 0.6, outputCostUsdPerM: 3, hint: '262K context' },
  { id: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 thinking', provider: 'Moonshot', inputCostUsdPerM: 0.6, outputCostUsdPerM: 2.5, hint: '推論型・長文' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', provider: 'DeepSeek', inputCostUsdPerM: 0.7, outputCostUsdPerM: 2.5, hint: '推論型・旧版' },
  { id: 'qwen/qwen3-max', label: 'Qwen3 Max', provider: 'Alibaba', inputCostUsdPerM: 0.78, outputCostUsdPerM: 3.9, hint: '多言語・日本語強め' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', provider: 'Moonshot', inputCostUsdPerM: 0.95, outputCostUsdPerM: 4, hint: '最新・32K context' },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', provider: 'Anthropic', inputCostUsdPerM: 1, outputCostUsdPerM: 5, hint: '速い・賢い' },
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'OpenAI', inputCostUsdPerM: 1.25, outputCostUsdPerM: 10, hint: 'OpenAI 高品質' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', inputCostUsdPerM: 1.25, outputCostUsdPerM: 10, hint: '推論強め' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', inputCostUsdPerM: 3, outputCostUsdPerM: 15, hint: '高品質・人気' },
  { id: 'anthropic/claude-opus-4.1', label: 'Claude Opus 4.1', provider: 'Anthropic', inputCostUsdPerM: 15, outputCostUsdPerM: 75, hint: '最強・高コスト' },
];

/** モデル ID から表の行を引く。**表に無ければ undefined**（0 円に倒さない）。 */
export function findModelMeta(modelId: string): OpenRouterModelMeta | undefined {
  return OPENROUTER_MODELS.find((m) => m.id === modelId);
}

/**
 * 実際に使ったトークン数から USD 原価を概算する。
 *
 * ⚠️ **表に無いモデルは null を返す**（0 を返さない）。0 だと「タダで動いた」と読めてしまい、
 * ベンチマークの比較表でも一番安いモデルとして並ぶ。分からないものは分からないと返す。
 */
export function estimateUsdCost(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): { inputUsd: number; outputUsd: number; totalUsd: number } | null {
  const meta = findModelMeta(modelId);
  if (!meta) return null;
  const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0;
  const outputTokens = Number.isFinite(usage.outputTokens) ? Math.max(0, usage.outputTokens) : 0;
  const inputUsd = (inputTokens / 1_000_000) * meta.inputCostUsdPerM;
  const outputUsd = (outputTokens / 1_000_000) * meta.outputCostUsdPerM;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}
