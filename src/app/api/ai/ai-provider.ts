// AI プロバイダ抽象層（OpenRouter 専用）。
//
// 旧 yorulog では Gemini 直叩き + OpenRouter override の二系統だったが、Gemini は
// 廃止済み（API キー削除）。本ファイルは OpenRouter のみを使う統一インターフェース。
//
// モデルは環境変数で指定する（"openrouter:provider/model" 形式）:
//   AI_PRIMARY_MODEL_FAST  … FAST 系（flash / lite）
//   AI_PRIMARY_MODEL_THINK … THINK 系（pro）
// 未設定の場合は明示的にエラーにする（フォールバック先は無い）。
//
// 2026-06-02 NOXA へ移設・OpenRouter 専用化。

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

/**
 * 環境変数から OpenRouter モデル ID を取り出す。
 * "openrouter:provider/model" 形式のときだけ provider/model を返す。
 */
function resolveOpenRouterModel(tier: ModelTier | undefined): string {
  const envValue = tier === 'pro'
    ? process.env.AI_PRIMARY_MODEL_THINK
    : process.env.AI_PRIMARY_MODEL_FAST;
  if (!envValue || !envValue.startsWith('openrouter:')) {
    throw new Error(
      'AI モデル未設定: AI_PRIMARY_MODEL_FAST / AI_PRIMARY_MODEL_THINK に "openrouter:provider/model" を設定してください（Gemini は廃止済み）。',
    );
  }
  return envValue.slice('openrouter:'.length);
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
  },
): Promise<string> {
  const model = resolveOpenRouterModel(options?.modelTier);
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
  },
): Promise<string> {
  const model = resolveOpenRouterModel(options.modelTier);
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
    onChunk: (text: string) => void;
  },
): Promise<string> {
  const model = resolveOpenRouterModel(options.modelTier);
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
  },
): Promise<string> {
  const model = resolveOpenRouterModel(options?.modelTier);
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
