// LINE 連続送信用の営業メッセージ生成 API。
//
// iOS `AIService.salesMessage` から呼ばれる薄いラッパーで、
// LineContinuousSendView の一括ドラフト生成が顧客ごとに 1 リクエスト走る。
// `/api/ai/message` と違って顧客 ID を必要とせず、name + context + hint だけで
// 営業文面のバリエーション 3 件を生成する（軽量・短時間応答を優先）。
//
// クレジットは `estimateAiCost` でメッセージ生成相当（featureMultiplier 1.0）を引当。

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';

interface SalesMessageBody {
  customerName?: string;
  context?: string;
  hint?: string | null;
}

const SYSTEM_INSTRUCTION = `あなたはナイトワーク（ホスト・ホステス・キャバ嬢）専門の LINE 営業メッセージ作成 AI です。
お客様への営業（来店促進・関係構築）を目的とした自然で押し付けがましくないメッセージを 3 パターン作成します。

## ルール
- 文字数は 150〜300 字程度
- 絵文字は 2〜3 個
- 押し付けがましくない、さりげない営業
- 相手の名前を必ず入れる
- メッセージ本文のみ出力（説明や注釈は不要）
- 3 パターンそれぞれトーンや切り口を変える（甘め / カジュアル / 丁寧めなど）
- 必ず改行を入れて読みやすく（1 メッセージあたり 2-4 回の改行目安）

## 文体チェック
- 改行が入っているか、1 文 30-50 字か、読点が 1 文で 2 個以内か
- 括弧書きで心の声・補足が残ってないか
- 禁止クリシェ（胸が締め付けられる / 言葉にならない / かけがえのない / 受け止めました 等）を使ってないか
- 20-30 代の夜職スタッフがほんまに書く文面になっているか

## 出力形式
JSON 配列で 3 つのメッセージを出力:
["メッセージ1", "メッセージ2", "メッセージ3"]`;

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json()) as SalesMessageBody;
    const customerName = body.customerName?.trim();
    if (!customerName) {
      return NextResponse.json({ error: 'customerName が必要です' }, { status: 400 });
    }

    const context = body.context?.trim() ?? '';
    const hint = body.hint?.trim() ?? '';

    const promptParts = [
      `顧客名: ${customerName}`,
      context ? `背景: ${context}` : '',
      hint ? `追加の指示: ${hint}` : '',
      '上記をもとに営業 LINE メッセージを 3 パターン生成してください。',
    ].filter(Boolean);
    const prompt = promptParts.join('\n\n');

    // クレジット引当（軽量メッセージ生成、出力 800 tok 想定）
    const cost = estimateAiCost({
      inputText: prompt,
      expectedOutputTokens: 800,
      featureMultiplier: 1.0,
    });
    const reserved = await reserveAiCredit(uid, cost);
    if (!reserved.ok) {
      return NextResponse.json(
        {
          error: 'AIクレジット不足',
          creditsRemaining: reserved.remaining,
          requiredCredits: cost,
        },
        { status: 429 },
      );
    }

    let result: string;
    try {
      result = await generateText(prompt, {
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 1200,
        temperature: 0.85,
        responseMimeType: 'application/json',
      });
    } catch (err) {
      await refundAiCredit(uid, cost);
      throw err;
    }

    let drafts: string[] = [];
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        drafts = parsed.filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0);
      }
    } catch {
      if (result?.trim()) drafts = [result.trim()];
    }

    if (drafts.length === 0) {
      await refundAiCredit(uid, cost);
      return NextResponse.json({ error: 'メッセージ生成に失敗しました' }, { status: 500 });
    }
    void logAiLedger(uid, 'sales-message', cost);

    // iOS AIService.DraftResponse は `drafts` または `message` を期待する
    return NextResponse.json({ drafts, creditsRemaining: reserved.remaining });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('POST /api/ai/sales-message failed:', error);
    return NextResponse.json({ error: 'メッセージ生成失敗' }, { status: 500 });
  }
}
