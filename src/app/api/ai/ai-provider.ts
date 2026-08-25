// AI プロバイダ抽象層（OpenRouter 専用）。
//
// 旧 yorulog では Gemini 直叩き + OpenRouter override の二系統だったが、Gemini は
// 廃止済み（API キー削除）。本ファイルは OpenRouter のみを使う統一インターフェース。
//
// モデルは環境変数で指定する（"openrouter:provider/model" 形式）:
//   AI_PRIMARY_MODEL_FAST  … flash（既定）
//   AI_PRIMARY_MODEL_THINK … pro（推論強め）
//   AI_PRIMARY_MODEL_LITE  … lite（短文向けの安いモデル・任意）
// 未設定の場合は明示的にエラーにする（フォールバック先は無い）。
// ただし lite だけは未設定なら FAST を使う（安くする最適化であって、
// 落とすほどのものではないため）。⚠️ **黙って落とさず 1 回だけログに出す**（P153）。
//
// 2026-06-02 NOXA へ移設・OpenRouter 専用化。
// 2026-08-25 P153: 呼び出し側が実際のモデル ID を知れるよう resolveChatModel を公開し、
//            options.model で明示指定できるようにした（chat/route.ts の実装 2 本を 1 本へ）。

import { assertAiEnabled } from '../lib/ai-kill-switch';
import {
  generateOpenRouterText,
  generateOpenRouterStream,
  type OpenRouterChatMessage,
} from './openrouter';

export type ModelTier = 'flash' | 'lite' | 'pro';

// Gemini 互換の履歴形式（呼び出し側の既存シグネチャを維持）
export interface ChatHistoryEntry {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** tier に対応する環境変数の名前と値。 */
function envForTier(tier: ModelTier | undefined): { name: string; value: string | undefined } {
  switch (tier) {
    case 'pro':
      return { name: 'AI_PRIMARY_MODEL_THINK', value: process.env.AI_PRIMARY_MODEL_THINK };
    case 'lite':
      return { name: 'AI_PRIMARY_MODEL_LITE', value: process.env.AI_PRIMARY_MODEL_LITE };
    default:
      return { name: 'AI_PRIMARY_MODEL_FAST', value: process.env.AI_PRIMARY_MODEL_FAST };
  }
}

/** "openrouter:provider/model" から provider/model を取り出す。形式違いは undefined。 */
function stripPrefix(envValue: string | undefined): string | undefined {
  if (!envValue || !envValue.startsWith('openrouter:')) return undefined;
  const id = envValue.slice('openrouter:'.length).trim();
  return id || undefined;
}

// lite の FAST 代替は 1 プロセスに 1 回だけ知らせる（リクエストごとに出すとログが埋まる）
let liteFallbackNotified = false;

/**
 * 環境変数から OpenRouter モデル ID を取り出す。
 * "openrouter:provider/model" 形式のときだけ provider/model を返す。
 *
 * ⚠️ lite は AI_PRIMARY_MODEL_LITE が無ければ FAST を使う（安く済ませる最適化なので、
 * 未設定で機能ごと止めない）。ただし**黙って落とさない**——初回に console.info を出し、
 * 「lite のつもりが FAST の値段で回っている」を運用側が気づけるようにする（P153）。
 */
function resolveOpenRouterModel(tier: ModelTier | undefined): string {
  const primary = envForTier(tier);
  const resolved = stripPrefix(primary.value);
  if (resolved) return resolved;

  if (tier === 'lite') {
    const fast = stripPrefix(process.env.AI_PRIMARY_MODEL_FAST);
    if (fast) {
      if (!liteFallbackNotified) {
        liteFallbackNotified = true;
        console.info(
          `[ai-provider] AI_PRIMARY_MODEL_LITE が未設定のため lite は AI_PRIMARY_MODEL_FAST (${fast}) で動作します`,
        );
      }
      return fast;
    }
  }

  throw new Error(
    `AI モデル未設定: ${primary.name} に "openrouter:provider/model" を設定してください（Gemini は廃止済み）。`,
  );
}

/**
 * 実際に呼ぶ OpenRouter モデル ID を決める。
 *
 * override（運営者が指定した値 / env 既定）があればそれを優先し、無ければ tier から解決する。
 * **呼び出し側が「実際に呼んだモデル」を知る唯一の入口**でもある
 * （SSE meta のモデル名を固定文字列で書くと実態とズレるため・P153 ③）。
 */
export function resolveChatModel(options?: {
  modelTier?: ModelTier;
  /** 既に "openrouter:" を剥がしたモデル ID */
  override?: string | null;
}): string {
  const override = options?.override?.trim();
  if (override) return override;
  return resolveOpenRouterModel(options?.modelTier);
}

function buildMessages(
  prompt: string,
  systemInstruction?: string,
  history?: ChatHistoryEntry[],
): OpenRouterChatMessage[] {
  const messages: OpenRouterChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  if (history) {
    for (const h of history) {
      messages.push({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.parts.map((p) => p.text).join('\n'),
      });
    }
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

/** テキスト生成。 */
export async function generateText(
  prompt: string,
  options?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    modelTier?: ModelTier;
    /** モデル ID を直接指定する（運営者 override 用。指定時は modelTier を見ない） */
    model?: string;
  },
): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**外部 API を叩く手前**で止めるので原価が発生しない。
  // ルート側の入口チェックを足し忘れてもここで確実に止まる（最後の砦）
  await assertAiEnabled();
  const model = resolveChatModel({ modelTier: options?.modelTier, override: options?.model });
  return generateOpenRouterText({
    model,
    messages: buildMessages(prompt, options?.systemInstruction),
    temperature: options?.temperature,
    maxTokens: options?.maxOutputTokens,
    responseFormat: options?.responseMimeType === 'application/json' ? 'json_object' : 'text',
  });
}

/** チャット生成（履歴対応）。 */
export async function generateChat(
  prompt: string,
  options: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    history?: ChatHistoryEntry[];
    modelTier?: ModelTier;
    /** モデル ID を直接指定する（運営者 override 用。指定時は modelTier を見ない） */
    model?: string;
  },
): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**外部 API を叩く手前**で止めるので原価が発生しない。
  // ルート側の入口チェックを足し忘れてもここで確実に止まる（最後の砦）
  await assertAiEnabled();
  const model = resolveChatModel({ modelTier: options.modelTier, override: options.model });
  return generateOpenRouterText({
    model,
    messages: buildMessages(prompt, options.systemInstruction, options.history),
    temperature: options.temperature,
    maxTokens: options.maxOutputTokens,
    responseFormat: options.responseMimeType === 'application/json' ? 'json_object' : 'text',
  });
}

/** チャット生成（ストリーミング）。 */
export async function generateChatStream(
  prompt: string,
  options: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    history?: ChatHistoryEntry[];
    modelTier?: ModelTier;
    /** モデル ID を直接指定する（運営者 override 用。指定時は modelTier を見ない） */
    model?: string;
    onChunk: (text: string) => void;
  },
): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**外部 API を叩く手前**で止めるので原価が発生しない。
  // ルート側の入口チェックを足し忘れてもここで確実に止まる（最後の砦）
  await assertAiEnabled();
  const model = resolveChatModel({ modelTier: options.modelTier, override: options.model });
  return generateOpenRouterStream(
    {
      model,
      messages: buildMessages(prompt, options.systemInstruction, options.history),
      temperature: options.temperature,
      maxTokens: options.maxOutputTokens,
      responseFormat: options.responseMimeType === 'application/json' ? 'json_object' : 'text',
    },
    options.onChunk,
  );
}

/**
 * 画像解析（マルチモーダル）。OpenRouter の Vision 対応モデルで処理する。
 * FAST/THINK に Vision 対応モデルを設定しておくこと。
 */
export async function analyzeImages(
  images: { data: string; mimeType: string }[],
  prompt: string,
  options?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    modelTier?: ModelTier;
    /** モデル ID を直接指定する（運営者 override 用。指定時は modelTier を見ない） */
    model?: string;
  },
): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**外部 API を叩く手前**で止めるので原価が発生しない。
  // ルート側の入口チェックを足し忘れてもここで確実に止まる（最後の砦）
  await assertAiEnabled();
  const model = resolveChatModel({ modelTier: options?.modelTier, override: options?.model });
  const messages: OpenRouterChatMessage[] = [];
  if (options?.systemInstruction) messages.push({ role: 'system', content: options.systemInstruction });

  // OpenAI 互換のマルチモーダル content（OpenRouter は image_url を受ける）
  type MultimodalContent = Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
  const userContent: MultimodalContent = [
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
    { type: 'text', text: prompt },
  ];
  messages.push({
    role: 'user',
    // OpenRouterChatMessage.content は string 型だが Vision は配列を受ける
    content: userContent as unknown as string,
  });

  return generateOpenRouterText({
    model,
    messages,
    temperature: options?.temperature,
    maxTokens: options?.maxOutputTokens,
    responseFormat: options?.responseMimeType === 'application/json' ? 'json_object' : 'text',
  });
}
