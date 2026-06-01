/**
 * AI チャットの動的クレジットコスト計算（クライアント / サーバー共用）。
 *
 * 設計思想:
 * - 単純なテキスト送信は 1 クレジット（最頻ケース）
 * - 長文ペースト（LINE 履歴、スクショの OCR 結果など）は input トークンが線形に増えるので
 *   2000 文字ごとに 1 クレジット加算する
 * - 画像添付は Gemini のマルチモーダル処理コストが大きいので 1 枚あたり +2 クレジット
 *
 * Gemini 2.5 Flash の概算コスト（2026-05 時点）:
 * - text input: $0.075 / M tokens、output: $0.30 / M tokens
 * - 画像 1 枚: 約 258 input tokens として課金
 * - 1 クレジット ≈ ¥0.1 を想定（1000 クレジット使い切って ¥100 原価 ≒ Pro ¥980 で利益確保）
 *
 * これにより 1 クレジット = 約 2000 文字相当 + 画像 0.5 枚相当の重さで揃う。
 * クライアント側はこの関数で送信前に表示し、サーバー側はこの関数で reserveAiCredit する。
 */

const BASE_COST = 1;
const CHARS_PER_EXTRA_CREDIT = 2000;
const COST_PER_IMAGE = 2;

// チャットのモデルモード:
// - FAST:  gemini-2.5-flash（標準）           クレジット 1.0x
// - THINK: gemini-2.5-pro（推論強め・遅い） クレジット 3.0x
//   Pro は input/output token が Flash より高く、出力も長くなるので約 3 倍と見積もる
export type ChatModelMode = 'fast' | 'think';
export const CHAT_MODEL_MULTIPLIER: Record<ChatModelMode, number> = {
  fast: 1,
  think: 3,
};

export function computeChatCost(
  message: string,
  imageCount: number = 0,
  mode: ChatModelMode = 'fast',
): number {
  const len = (message ?? '').length;
  const textCost = Math.max(BASE_COST, Math.ceil(len / CHARS_PER_EXTRA_CREDIT));
  const imageCost = imageCount * COST_PER_IMAGE;
  const baseTotal = textCost + imageCost;
  return Math.max(1, Math.ceil(baseTotal * CHAT_MODEL_MULTIPLIER[mode]));
}

/**
 * クレジットコストの内訳をユーザーに見せたいときに使う。
 * UI のツールチップや送信ボタンの補助表示用。
 */
export function describeChatCost(
  message: string,
  imageCount: number = 0,
  mode: ChatModelMode = 'fast',
): {
  total: number;
  breakdown: { base: number; image: number; multiplier: number };
} {
  const total = computeChatCost(message, imageCount, mode);
  const text = Math.max(BASE_COST, Math.ceil((message ?? '').length / CHARS_PER_EXTRA_CREDIT));
  const image = imageCount * COST_PER_IMAGE;
  return {
    total,
    breakdown: { base: text, image, multiplier: CHAT_MODEL_MULTIPLIER[mode] },
  };
}

/**
 * 汎用 AI コスト見積もり（v2、2026-05-12 追加）。
 *
 * チャット以外の API ルート（message / reply / insights / customer-extract /
 * profile-extract / learn-from-text 等）でも一律にこの関数で消費 cr を算出する。
 *
 * 計算ルール:
 *   - base: 1 cr
 *   - 入力テキスト 2000 字ごとに +1 cr
 *   - 画像 1 枚: +2 cr
 *   - 想定出力 1000 字（≒ 750 tokens）ごとに +0.5 cr
 *   - THINK モード倍率: ×3（pro モデル相当）
 *   - 追加倍率: 1.0（呼び出し側が機能特性で上乗せできる、例: insights = 1.5）
 *
 * 最小 1 cr、最大 30 cr（暴走ガード）。
 */
export interface EstimateAiCostInput {
  /** メイン入力テキスト（system + user の合計長で OK） */
  inputText: string;
  /** 画像枚数（マルチモーダル時） */
  imageCount?: number;
  /** 想定する最大出力トークン数（推定で OK） */
  expectedOutputTokens?: number;
  /** THINK モード（pro / reasoning モデル使用時に true） */
  thinkMode?: boolean;
  /** 機能特性による追加倍率（insights = 1.5、reply = 1.2 等） */
  featureMultiplier?: number;
  /** 強制上限（呼び出し側が独自に絞りたい場合） */
  maxCap?: number;
}

const CHARS_PER_CREDIT = 2000;
const COST_PER_IMG = 2;
const COST_PER_1K_OUTPUT_TOKENS = 0.5; // 750 chars ≒ 1000 tokens 想定
const THINK_MULTIPLIER = 3;
const ABSOLUTE_MAX = 30;

export function estimateAiCost(input: EstimateAiCostInput): number {
  const len = (input.inputText ?? '').length;
  // 入力テキストが空のときは base 1cr を立てない（画像のみケースで二重課金回避）
  const inputCost = len === 0 ? 0 : Math.max(1, Math.ceil(len / CHARS_PER_CREDIT));
  const imageCount = Number.isFinite(input.imageCount) ? Math.max(0, input.imageCount!) : 0;
  const imageCost = imageCount * COST_PER_IMG;
  const expectedOutput = Number.isFinite(input.expectedOutputTokens) ? Math.max(0, input.expectedOutputTokens!) : 0;
  const outputCost = Math.ceil((expectedOutput / 1000) * COST_PER_1K_OUTPUT_TOKENS);
  const subTotal = inputCost + imageCost + outputCost;
  const withThink = input.thinkMode ? subTotal * THINK_MULTIPLIER : subTotal;
  const rawFeatureMul = input.featureMultiplier ?? 1;
  const featureMul = Number.isFinite(rawFeatureMul) && rawFeatureMul > 0 ? rawFeatureMul : 1;
  const withFeature = withThink * featureMul;
  // maxCap: undefined → ABSOLUTE_MAX、Number.POSITIVE_INFINITY を渡せば上限なし
  const cap = input.maxCap ?? ABSOLUTE_MAX;
  const result = Math.max(1, Math.min(cap, Math.ceil(withFeature)));
  return Number.isFinite(result) ? result : 1;
}

/**
 * 内訳付きで返す（UI 表示用）。
 */
export function describeAiCost(input: EstimateAiCostInput): {
  total: number;
  breakdown: { input: number; image: number; output: number; thinkMultiplier: number; featureMultiplier: number };
} {
  const len = (input.inputText ?? '').length;
  const inputCost = len === 0 ? 0 : Math.max(1, Math.ceil(len / CHARS_PER_CREDIT));
  const imageCount = Number.isFinite(input.imageCount) ? Math.max(0, input.imageCount!) : 0;
  const imageCost = imageCount * COST_PER_IMG;
  const expectedOutput = Number.isFinite(input.expectedOutputTokens) ? Math.max(0, input.expectedOutputTokens!) : 0;
  const outputCost = Math.ceil((expectedOutput / 1000) * COST_PER_1K_OUTPUT_TOKENS);
  const rawFeatureMul = input.featureMultiplier ?? 1;
  const featureMul = Number.isFinite(rawFeatureMul) && rawFeatureMul > 0 ? rawFeatureMul : 1;
  return {
    total: estimateAiCost(input),
    breakdown: {
      input: inputCost,
      image: imageCost,
      output: outputCost,
      thinkMultiplier: input.thinkMode ? THINK_MULTIPLIER : 1,
      featureMultiplier: featureMul,
    },
  };
}
