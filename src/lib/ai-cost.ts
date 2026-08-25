/**
 * AI チャットの動的クレジットコスト計算（クライアント / サーバー共用）。
 *
 * 設計思想:
 * - 単純なテキスト送信は 1 クレジット（最頻ケース）
 * - 長文ペースト（LINE 履歴、スクショの OCR 結果など）は input トークンが線形に増えるので
 *   2000 文字ごとに 1 クレジット加算する
 * - 画像添付は 1 枚あたり +2 クレジット
 *
 * ⚠️ **単価の前提をこのコメントに直書きしない**（P153 ④）。
 * 旧コメントは「Gemini 2.5 Flash は input $0.075 / output $0.30 / M tokens、
 * 1 クレジット ≈ ¥0.1 原価」と書いていたが、これは **Gemini を直叩きしていた頃の値**。
 * 直書きの数字は表を更新しても誰も直さないので、単価は `src/lib/ai-models.ts` の
 * `OPENROUTER_MODELS` を正本とし、下の `COST_BASIS` / `referenceRequestCostJpy()` で
 * **表から導く**。表と実勢の乖離は `node scripts/check-model-prices.mjs` で検出する。
 *
 * ⚠️ **1cr の実原価は設計前提「≒ ¥0.1」の約 4 倍**（中間ケースで ¥0.41）。
 * 課金式が `message.length` しか数えず、**毎リクエスト載る固定プロンプト約 4,793 字を
 * 1 文字も課金していない**ため、短文ほど利幅が薄い。詳細は yorulog の
 * `docs/AI_CREDIT_COST_AUDIT.md`（2026-08-25・訂正済み版）。
 * **値付けは事業判断なのでコード側では変えない**（ユーザー判断待ち:
 * 生成系の価格 / 画像解析を課金対象にするか）。
 *
 * クライアント側はこの関数で送信前に表示し、サーバー側はこの関数で reserveAiCredit する。
 */

import { findModelMeta, estimateUsdCost } from './ai-models';

/**
 * 原価を語るときの基準。**単価の正本は OPENROUTER_MODELS**（ここは参照先と前提だけ持つ）。
 *
 * トークン数は yorulog の `docs/AI_CREDIT_COST_AUDIT.md` §3「中（顧客＋履歴あり）」の実測。
 * 固定プロンプト 4,793 字 + 顧客コンテキスト + 履歴 20 件で input 6,764 tok / output 600 tok。
 *
 * `referenceModelId` は **本番の `AI_PRIMARY_MODEL_FAST` の実測値**
 * （`vercel env pull --environment=production` で 2026-08-25 に確認。THINK は
 * `openrouter:openai/gpt-5.6-luna`）。単価も OpenRouter 公開 API で実測済み。
 * ⚠️ 読めないのは `OPENROUTER_API_KEY` の方（こちらは Sensitive のまま空文字で返る）。
 * ⚠️ 本番に `AI_PRIMARY_MODEL_LITE` は**無い**ので、lite の 3 経路（suggest / briefing / tags）は
 * 現状 FAST の単価で回っている（P153 ⑤ のログで気づける）。
 */
export const COST_BASIS = {
  /** 原価の話をするときの物差しにするモデル */
  referenceModelId: 'google/gemini-3.1-flash-lite',
  /** open.er-api.com（2026-08-24 更新）。円は動くので原価の議論では日付とセットで扱う */
  jpyPerUsd: 158.906,
  assumedInputTokens: 6764,
  assumedOutputTokens: 600,
} as const;

/**
 * `COST_BASIS` の前提で 1 チャットにかかる概算原価（円）。
 *
 * ⚠️ 基準モデルが表から消えたら **null**（0 に倒さない。0 は「タダ」という意味のある値で、
 * 採算の議論を静かに壊す）。P150 の「分からないを 0 にしない」と同じ扱い。
 */
export function referenceRequestCostJpy(): number | null {
  const cost = estimateUsdCost(COST_BASIS.referenceModelId, {
    inputTokens: COST_BASIS.assumedInputTokens,
    outputTokens: COST_BASIS.assumedOutputTokens,
  });
  if (!cost) return null;
  return cost.totalUsd * COST_BASIS.jpyPerUsd;
}

/** 基準モデルが表にあるか（コメントの数字が独り歩きしていないかの確認用）。 */
export function hasCostReferenceModel(): boolean {
  return findModelMeta(COST_BASIS.referenceModelId) !== undefined;
}

const BASE_COST = 1;
const CHARS_PER_EXTRA_CREDIT = 2000;
const COST_PER_IMAGE = 2;

// チャットのモデルモード（実際のモデルは env で決まる。ここはクレジット倍率だけ）:
// - FAST:  AI_PRIMARY_MODEL_FAST  クレジット 1.0x
// - THINK: AI_PRIMARY_MODEL_THINK クレジット 3.0x
//   THINK は単価が高く出力も長くなる（上限 2,048 → 4,096 tokens）ので約 3 倍と見積もる。
//   ⚠️ 旧コメントは gemini-2.5-flash / gemini-2.5-pro 決め打ちだったが、
//   Gemini 直叩き経路は廃止済みでモデル名は env 次第（P153 ④）
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
