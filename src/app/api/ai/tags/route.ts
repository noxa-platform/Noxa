import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { customerName, logs, existingTags } = await request.json();

    if (!customerName) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    // 既存タグ一覧をプロンプトに含めるための文字列を構築
    const existingTagsPrompt = Array.isArray(existingTags) && existingTags.length > 0
      ? `\nワークスペース内で使用中のタグ一覧:\n[${existingTags.join(', ')}]\n\nできるだけ既存タグから選んでください。新しいタグを作る場合は既存タグと表記を統一してください。`
      : '';

    const logsContext = Array.isArray(logs)
      ? logs.map((l: Record<string, unknown>) => `${l.type}: ${l.memo || ''} (場所: ${l.place || '不明'})`).join('\n')
      : 'ログなし';

    // タグ生成は軽量なのでベース最小だが、ログ数に比例
    const tagsCost = estimateAiCost({
      inputText: existingTagsPrompt + logsContext,
      expectedOutputTokens: 400,
    });
    const reserved = await reserveAiCredit(uid, tagsCost);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: tagsCost }, { status: 429 });
    }

    let content: string;
    try {
      content = await generateText(
        `顧客名: ${customerName}\nログ内容:\n${logsContext}`,
        {
          systemInstruction: `あなたはNoxaの自動タグ付けAIです。
顧客のログ（メモ、場所、種別）から嗜好や特徴を自動抽出し、タグを提案してください。
${existingTagsPrompt}
ルール:
- 5個以内のタグを提案
- 既存のNoxaタグ形式に合わせる（短く、わかりやすい）
- JSON配列で出力: ["タグ1", "タグ2", ...]
- 例: ["お酒好き", "話し上手", "シャンパン派", "週末常連", "記念日重視"]`,
          maxOutputTokens: 200,
          temperature: 0.5,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, tagsCost);
      throw err;
    }
    void logAiLedger(uid, 'tags', tagsCost);

    let tags: string[];
    try {
      tags = JSON.parse(content);
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = content.replace(/[\[\]"]/g, '').split(',').map((t) => t.trim()).filter(Boolean);
    }

    return NextResponse.json({
      tags,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI tags error:', error);
    return NextResponse.json({ error: 'タグ生成失敗' }, { status: 500 });
  }
}
