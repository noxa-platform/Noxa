// OpenRouter 経由で各種 LLM を呼ぶラッパ。
//
// OpenRouter は OpenAI 互換 API なので、fetch ベースで簡潔に書ける。
// Provider 切替（gemini.ts vs openrouter.ts）の判断はクライアントから受け取った
// model 文字列（"openrouter:provider/model" 形式）で各 API route が行う。
//
// 環境変数:
//   OPENROUTER_API_KEY - 必須
//   OPENROUTER_HTTP_REFERER - 任意（OpenRouter dashboard で識別される）
//   OPENROUTER_X_TITLE     - 任意（同上）
//
// 「openrouter:」のプレフィックスは API route 側で剥がして、ここに渡されるのは
// 純粋なモデル ID（"anthropic/claude-sonnet-4" など）。

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

/**
 * 推奨モデルリスト。クライアント側のセレクター UI で使う。
 * id は OpenRouter のモデル ID（"provider/model" 形式）。
 * cost は概算（USD/M tokens）、UI 表示と将来の課金計算用。
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
  // 値段の安い順 → 高い順で並べる。コスト情報は OpenRouter dashboard 経由で実測した値（2026-05-12）。
  // ※ OpenRouter は価格を時期によって調整するため、ここは目安。実コストはダッシュボード参照。
  { id: 'qwen/qwen3-235b-a22b-2507', label: 'Qwen3 235B (2507)', provider: 'Alibaba', inputCostUsdPerM: 0.07, outputCostUsdPerM: 0.10, hint: '激安・大モデル' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'DeepSeek', inputCostUsdPerM: 0.14, outputCostUsdPerM: 0.28, hint: '最新・1M context・コスパ最強' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'Google', inputCostUsdPerM: 0.10, outputCostUsdPerM: 0.40, hint: '激安・短文向け' },
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1', provider: 'DeepSeek', inputCostUsdPerM: 0.21, outputCostUsdPerM: 0.79, hint: '安定版' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 mini', provider: 'OpenAI', inputCostUsdPerM: 0.25, outputCostUsdPerM: 2.00, hint: 'OpenAI 軽量' },
  { id: 'deepseek/deepseek-v3.2-exp', label: 'DeepSeek V3.2 exp', provider: 'DeepSeek', inputCostUsdPerM: 0.27, outputCostUsdPerM: 0.41, hint: '実験版・日本語強い' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', inputCostUsdPerM: 0.30, outputCostUsdPerM: 2.50, hint: '汎用・低コスト' },
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot', inputCostUsdPerM: 0.40, outputCostUsdPerM: 1.98, hint: '262K context' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'DeepSeek', inputCostUsdPerM: 0.43, outputCostUsdPerM: 0.87, hint: '最新 Pro・1M context' },
  { id: 'deepseek/deepseek-r1-0528', label: 'DeepSeek R1 (0528)', provider: 'DeepSeek', inputCostUsdPerM: 0.50, outputCostUsdPerM: 2.15, hint: '推論型・新版' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', provider: 'DeepSeek', inputCostUsdPerM: 0.70, outputCostUsdPerM: 2.50, hint: '推論型・旧版' },
  { id: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 thinking', provider: 'Moonshot', inputCostUsdPerM: 0.60, outputCostUsdPerM: 2.50, hint: '推論型・長文' },
  { id: 'qwen/qwen3-max', label: 'Qwen3 Max', provider: 'Alibaba', inputCostUsdPerM: 0.78, outputCostUsdPerM: 3.90, hint: '多言語・日本語強め' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', provider: 'Moonshot', inputCostUsdPerM: 0.74, outputCostUsdPerM: 3.50, hint: '最新・32K context' },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', provider: 'Anthropic', inputCostUsdPerM: 1.00, outputCostUsdPerM: 5.00, hint: '速い・賢い' },
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'OpenAI', inputCostUsdPerM: 1.25, outputCostUsdPerM: 10.00, hint: 'OpenAI 高品質' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', inputCostUsdPerM: 1.25, outputCostUsdPerM: 10.00, hint: '推論強め' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', inputCostUsdPerM: 3.00, outputCostUsdPerM: 15.00, hint: '高品質・人気' },
  { id: 'anthropic/claude-opus-4.1', label: 'Claude Opus 4.1', provider: 'Anthropic', inputCostUsdPerM: 15.00, outputCostUsdPerM: 75.00, hint: '最強・高コスト' },
];
