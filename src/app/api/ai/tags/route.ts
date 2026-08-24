import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse } from '@/app/api/lib/ai-kill-switch';
import { maskContactInfo } from '@/lib/ai-privacy';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // AI 緊急停止（2026-08-25）。**クレジット予約より手前**で弾く
    // （予約→拒否→返金の往復を作らない）。停止中は 503 + 日本語文言を返し、
    // iOS の APIError.serverError がその文字列をそのまま画面に出す。
    // ⚠️ 429 は使わない（iOS が insufficientCredits として残高表示を書き換えるため）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;
    const { customerName, logs, existingTags } = await request.json().catch(() => ({}));

    if (!customerName) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    // 既存タグ一覧。**クライアントから来る値なので system 側には置かない**（P130）。
    // 旧実装は systemInstruction にそのまま埋めており、タグ名に指示文を仕込めば
    // ルール本体と同じ重みで読まれる形だった。ユーザープロンプト側へ移し、囲って渡す。
    const existingTagsPrompt = Array.isArray(existingTags) && existingTags.length > 0
      ? `\n\n${wrapUntrustedInput(existingTags.map(String).join(', '), 'ワークスペース内で使用中のタグ一覧')}`
      : '';

    // 来店ログの memo は**保存済みの顧客フリーテキスト**（Day12 ポリシーのマスク対象）。
    // 旧実装は「書き込み側」として分類され素通しになっていた（Day127 で是正）
    const logsContext = Array.isArray(logs)
      ? maskContactInfo(logs.map((l: Record<string, unknown>) => `${l.type}: ${l.memo || ''} (場所: ${l.place || '不明'})`).join('\n'))
      : 'ログなし';

    // 顧客名・メモとも、相手が名乗った文字列や相手の発言の書き写しが入る。
    // 指示ではなくデータであることをマーカーで固定する（P130）
    const userPrompt = `${wrapUntrustedInput(`顧客名: ${customerName}\nログ内容:\n${logsContext}`, '解析対象')}${existingTagsPrompt}`;

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
        userPrompt,
        {
          systemInstruction: withInjectionGuard(`あなたはNoxaの自動タグ付けAIです。
顧客のログ（メモ、場所、種別）から嗜好や特徴を自動抽出し、タグを提案してください。
既存タグ一覧が渡されていれば、できるだけそこから選び、新規タグも既存の表記に揃えてください。

ルール:
- 5個以内のタグを提案
- 既存のNoxaタグ形式に合わせる（短く、わかりやすい）
- JSON配列で出力: ["タグ1", "タグ2", ...]
- 例: ["お酒好き", "話し上手", "シャンパン派", "週末常連", "記念日重視"]`),
          maxOutputTokens: 200,
          temperature: 0.5,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, tagsCost, reserved);
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
