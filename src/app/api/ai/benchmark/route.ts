// 運営者専用: AI モデルベンチマーク API。
//
// /dev/ai-models から呼ばれて、指定の model + prompt を OpenRouter 経由で 1 回実行し、
// 応答 + 所要時間 + 推定コスト（tokens 入力 / 出力それぞれ）を返す。
//
// 既存の /api/ai/chat とは独立:
//   - workspaceId / threadId 不要（純粋なモデル性能比較なので Firestore 連動しない）
//   - クレジット消費なし（運営者試行用）
//   - admin 限定（一般ユーザーは弾く）
//
// 入力:
//   { model: string, system: string, user: string, maxTokens?: number, temperature?: number }
//
// 出力:
//   { ok: true, reply: string, elapsedMs: number, model: string,
//     usage: { promptTokens, completionTokens, totalTokens, costUsd },
//     modelMeta: { inputCostUsdPerM, outputCostUsdPerM } }
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError, getAdminAuth } from '../../lib/firebase-admin';
import { isAdmin } from '@/lib/admin';
import { OPENROUTER_MODELS } from '../openrouter';

interface BenchRequest {
  model: string; // "provider/model" 形式（OpenRouter モデル ID）
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

const OR_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const userRecord = await getAdminAuth().getUser(uid);
    if (!isAdmin(userRecord.email)) {
      return NextResponse.json({ error: '運営者専用です' }, { status: 403 });
    }
    const body = (await request.json()) as BenchRequest;
    if (!body.model || !body.system || !body.user) {
      return NextResponse.json({ error: 'model / system / user が必要' }, { status: 400 });
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY が未設定' }, { status: 500 });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (process.env.OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
    if (process.env.OPENROUTER_X_TITLE) headers['X-Title'] = process.env.OPENROUTER_X_TITLE;

    const startedAt = Date.now();
    // GPT-5 / o 系は reasoning low + 最低 1500 tokens で空応答を回避
    const isReasoningModel = body.model.startsWith('openai/gpt-5') || body.model.startsWith('openai/o');
    const reqBody: Record<string, unknown> = {
      model: body.model,
      messages: [
        { role: 'system', content: body.system },
        { role: 'user', content: body.user },
      ],
      temperature: body.temperature ?? 0.6,
      max_tokens: Math.max(isReasoningModel ? 1500 : 0, body.maxTokens ?? 1500),
    };
    if (isReasoningModel) {
      reqBody.reasoning = { effort: 'low' };
    }
    const res = await fetch(OR_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });
    const elapsedMs = Date.now() - startedAt;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `OpenRouter ${res.status}`, detail: errText.slice(0, 1000) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const reply = data.choices?.[0]?.message?.content ?? '';
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    // コスト概算: OPENROUTER_MODELS に記載した USD/M tokens を採用
    const meta = OPENROUTER_MODELS.find((m) => m.id === body.model);
    const inputCost = meta ? (promptTokens / 1_000_000) * meta.inputCostUsdPerM : 0;
    const outputCost = meta ? (completionTokens / 1_000_000) * meta.outputCostUsdPerM : 0;
    const costUsd = inputCost + outputCost;

    return NextResponse.json({
      ok: true,
      reply,
      elapsedMs,
      model: body.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
        inputCostUsd: inputCost,
        outputCostUsd: outputCost,
      },
      modelMeta: meta
        ? { inputCostUsdPerM: meta.inputCostUsdPerM, outputCostUsdPerM: meta.outputCostUsdPerM, label: meta.label, provider: meta.provider }
        : null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('benchmark failed:', error);
    return NextResponse.json({ error: 'ベンチマークに失敗しました' }, { status: 500 });
  }
}
