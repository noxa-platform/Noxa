import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';

const MAX_BYTES = 1024 * 1024; // 1MB（learn-from-text と整合）

/**
 * LINE トーク履歴（または任意のメッセージ列）から顧客プロファイルを抽出する。
 *
 * 入力:
 *  - text: 解析対象テキスト（LINE のトーク履歴をそのまま貼り付けた状態を想定）
 *  - hint?: ユーザー側の補足（「Aさんとの 2 ヶ月分の履歴」等、任意）
 *
 * 出力（JSON）:
 *  - name, mbti, interests, charmingTopics, avoidTopics, communicationStyle,
 *    notes, suggestedTags
 *
 * クレジットコスト: estimateAiCost で動的算出（テキスト量比例、上限なし）
 *
 * 安全性:
 *  - prompt-injection ガードは gemini.ts 側で systemInstruction に自動注入
 *  - 入力テキストはあくまで「データ」として扱う旨を System で明示
 */
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json();
    const workspaceId: string | undefined = body?.workspaceId;
    const text: string | undefined = body?.text;
    const hint: string | undefined = body?.hint;

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId は必須です' },
        { status: 400 },
      );
    }
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return NextResponse.json(
        { error: 'text フィールドに 10 文字以上のメッセージ履歴を渡してください' },
        { status: 400 },
      );
    }
    const byteLength = new TextEncoder().encode(text).length;
    if (byteLength > MAX_BYTES) {
      return NextResponse.json({ error: '本文が大きすぎます（最大 1MB）' }, { status: 413 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    // テキスト量に応じてクレジット見積もり（上限なし、learn-from-text と整合）
    const extractCost = estimateAiCost({
      inputText: text,
      expectedOutputTokens: 1500,
      featureMultiplier: 1.2,
      maxCap: Number.POSITIVE_INFINITY,
    });

    return await withReservedCredits(uid, extractCost, async ({ ack, remaining }) => {
      const raw = await generateText(
        `## 解析対象テキスト\n${text}\n\n${hint ? `## 補足\n${hint}\n\n` : ''}上記の会話履歴から、相手（顧客）に関する情報を JSON で抽出してください。判断に迷う項目は null を返し、推測で埋めないこと。`,
        {
          systemInstruction: `あなたはホスト・キャバ嬢の顧客台帳作成を支援する AI です。
LINE 等のメッセージ履歴から、相手（顧客）の情報を抽出して JSON で返します。

ルール:
- 不確実な情報は推測せず null を返す
- 「自分」と「相手」を取り違えない（相手 = 接客対象）
- 出力は会話履歴の事実のみに基づく

出力形式（JSON、すべてのキーは必須、未取得は null）:
{
  "name": "相手の名前または呼び名（例: たかし、Aさん、社長）",
  "mbti": "推定 MBTI（INTJ など）/ 不明なら null",
  "interests": ["趣味・関心ごと（5 項目以内）"],
  "charmingTopics": ["相手が乗ってくる話題（3 項目以内）"],
  "avoidTopics": ["地雷・避けたい話題（3 項目以内）"],
  "communicationStyle": "コミュニケーション特徴の短い文（1 行）",
  "notes": "ノート（自由テキスト、500 文字以内）",
  "suggestedTags": ["顧客タグ候補（5 項目以内、例: 太客 / 同伴済 / お酒強い）"]
}`,
          maxOutputTokens: 1500,
          temperature: 0.4,
          responseMimeType: 'application/json',
          modelTier: 'flash',
        },
      );

      let extracted: Record<string, unknown> = {};
      try {
        extracted = JSON.parse(raw);
      } catch {
        // JSON パース失敗時は素のテキストを notes に詰めて返す
        extracted = { notes: raw, name: null };
      }

      ack();
      return NextResponse.json({
        profile: extracted,
        creditsRemaining: remaining,
      });
    }, 'customer-extract');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI customer-extract error:', error);
    return NextResponse.json({ error: '抽出に失敗しました' }, { status: 500 });
  }
}
