import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse } from '@/app/api/lib/ai-kill-switch';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { pickForAi, AI_CUSTOMER_FIELDS, AI_LOG_FIELDS } from '@/lib/ai-privacy';

async function getCustomerWithLogs(workspaceId: string, customerId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const [customerSnap, logsSnap] = await Promise.all([
      db.doc(`shop_shops/${workspaceId}/customers/${customerId}`).get(),
      db.collection(`shop_shops/${workspaceId}/customers/${customerId}/logs`)
        .orderBy('date', 'desc')
        .limit(10)
        .get(),
    ]);

    // PII ガード（Day12）: doc 丸ごと送信をやめ、allowlist 抽出＋連絡先マスクを通す
    // （旧実装は電話・メール等を含む全フィールドを AI プロンプトへ載せていた）
    return JSON.stringify({
      customer: pickForAi(customerSnap.exists ? customerSnap.data() : undefined, AI_CUSTOMER_FIELDS),
      recentLogs: logsSnap.docs.map((d) => pickForAi(d.data(), AI_LOG_FIELDS)),
    });
  } catch (e) {
    console.error('getCustomerWithLogs error:', e);
    return '{}';
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);

    // AI 緊急停止（2026-08-25）。**クレジット予約より手前**で弾く
    // （予約→拒否→返金の往復を作らない）。停止中は 503 + 日本語文言を返し、
    // iOS の APIError.serverError がその文字列をそのまま画面に出す。
    // ⚠️ 429 は使わない（iOS が insufficientCredits として残高表示を書き換えるため）
    const killed = await aiKillSwitchResponse(uid);
    if (killed) return killed;
    const { workspaceId, customerId, lastLogType } = await request.json().catch(() => ({}));

    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    const context = await getCustomerWithLogs(workspaceId, customerId);

    // 顧客コンテキスト量に応じてクレジット計算
    const suggestCost = estimateAiCost({
      inputText: JSON.stringify(context),
      expectedOutputTokens: 600,
    });
    const reserved = await reserveAiCredit(uid, suggestCost);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: suggestCost }, { status: 429 });
    }

    let content: string;
    try {
      content = await generateText(
        `顧客データ:\n${context}\n\n直前のログ種別: ${lastLogType || '不明'}\n\n次のアクションを提案してください。`,
        {
          systemInstruction: `あなたはNoxaのAIアドバイザーです。
ログ入力後に次のアクションを提案します。

出力形式（JSON）:
{
  "nextAction": "推奨する次のアクション（20文字以内）",
  "timing": "推奨タイミング（例: 3日後、来週、今週末）",
  "reason": "提案理由（30文字以内）",
  "messageIdea": "LINEメッセージのアイデア（50文字以内、省略可）"
}`,
          maxOutputTokens: 300,
          temperature: 0.7,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, suggestCost);
      throw err;
    }
    void logAiLedger(uid, 'suggest', suggestCost);

    let suggestion;
    try {
      suggestion = JSON.parse(content);
    } catch {
      suggestion = { nextAction: 'フォロー連絡', timing: '3日後', reason: '関係維持のため' };
    }

    return NextResponse.json({
      suggestion,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI suggest error:', error);
    return NextResponse.json({ error: '提案生成失敗' }, { status: 500 });
  }
}
