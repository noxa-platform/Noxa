// OpenRouter 経由で各種 LLM を呼ぶラッパ。
//
// OpenRouter は OpenAI 互換 API なので、fetch ベースで簡潔に書ける。
// モデルの選択はクライアント/env から受け取った model 文字列
// （"openrouter:provider/model" 形式）で各 API route が行う。
// （旧コメントは「gemini.ts vs openrouter.ts の切替」と書いていたが、
//   gemini.ts はこのリポの履歴に一度も存在しない。P130 で是正した同型の記述）
//
// 環境変数:
//   OPENROUTER_API_KEY - 必須
//   OPENROUTER_HTTP_REFERER - 任意（OpenRouter dashboard で識別される）
//   OPENROUTER_X_TITLE     - 任意（同上）
//
// 「openrouter:」のプレフィックスは API route 側で剥がして、ここに渡されるのは
// 純粋なモデル ID（"anthropic/claude-sonnet-4" など）。

import { assertAiEnabled } from '../lib/ai-kill-switch';

const OR_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function ensureKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY が設定されていません');
  return key;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ensureKey()}`,
    'Content-Type': 'application/json',
  };
  if (process.env.OPENROUTER_HTTP_REFERER) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
  }
  if (process.env.OPENROUTER_X_TITLE) {
    headers['X-Title'] = process.env.OPENROUTER_X_TITLE;
  }
  return headers;
}

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterChatOptions {
  /** OpenRouter のモデル ID（例: "anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-flash"） */
  model: string;
  /** チャット履歴 + 今回の prompt をまとめた messages 配列 */
  messages: OpenRouterChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** JSON モードを使う場合 'json_object' を指定 */
  responseFormat?: 'text' | 'json_object';
}

/**
 * OpenRouter で 1 回テキスト生成して、文字列を返す。
 * 失敗時は例外で投げる（API route 側で reserveAiCredit 連動の refund を実施）。
 */
export async function generateOpenRouterText(options: OpenRouterChatOptions): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**OpenRouter を叩く直前**の最後の砦。
  // chat/route.ts は ai-provider を経由せずここを直接呼ぶため、ここに置かないと
  // 一番の支出源が素通りする
  await assertAiEnabled();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1500,
  };
  if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  // GPT-5 / o 系の reasoning モデル対応（stream 側と同じ判定）
  if (options.model.startsWith('openai/gpt-5') || options.model.startsWith('openai/o')) {
    body.reasoning = { effort: 'low' };
    if ((body.max_tokens as number) < 1500) body.max_tokens = 1500;
  }
  const res = await fetch(OR_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  return text;
}

/**
 * OpenRouter でストリーミング応答を取得。
 * chunk ごとに onChunk(text) を呼び、最後に full text を返す。
 * AI チャットの SSE 配信に直結させる用途。
 */
export async function generateOpenRouterStream(
  options: OpenRouterChatOptions,
  onChunk: (text: string) => void,
): Promise<string> {
  // 緊急停止スイッチ（2026-08-25）。**OpenRouter を叩く直前**の最後の砦。
  // chat/route.ts は ai-provider を経由せずここを直接呼ぶため、ここに置かないと
  // 一番の支出源が素通りする
  await assertAiEnabled();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1500,
    stream: true,
  };
  if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  // OpenAI 系の reasoning モデル（GPT-5 / o3 系）は、reasoning パラメータを
  // 指定しないと max_tokens を内部 reasoning に食われて空応答になる。
  // effort: 'low' で reasoning 消費を最小化し、ベンチマーク v2 で実用化を確認。
  if (options.model.startsWith('openai/gpt-5') || options.model.startsWith('openai/o')) {
    body.reasoning = { effort: 'low' };
    // max_tokens を最低 1500 に底上げ（reasoning に食われる余地を確保）
    if ((body.max_tokens as number) < 1500) body.max_tokens = 1500;
  }

  const res = await fetch(OR_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter stream ${res.status}: ${errText.slice(0, 500)}`);
  }
  if (!res.body) throw new Error('OpenRouter stream: body 無し');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE フレーム: "data: {...}\n\n"
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = parsed.choices?.[0]?.delta?.content;
          if (piece) {
            full += piece;
            onChunk(piece);
          }
        } catch {
          // ハートビート等の無視
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

// モデル表（OPENROUTER_MODELS / OpenRouterModelMeta）は src/lib/ai-models.ts へ移した。
// 単価はクライアント共用の ai-cost.ts からも参照するため、fetch を抱えたこのファイルには置けない（P153 ④）。
