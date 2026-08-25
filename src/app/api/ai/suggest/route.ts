import { NextRequest, NextResponse } from 'next/server';
import { aiKillSwitchResponse, aiDisabledResponse } from '@/app/api/lib/ai-kill-switch';
import { generateText } from '../ai-provider';
import { withInjectionGuard, wrapUntrustedInput } from '@/lib/ai-knowledge/injection-guard';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomer, pathCustomerLogs, type AccessContext } from '../../lib/access-context';
import { pickForAi, AI_CUSTOMER_FIELDS, AI_LOG_FIELDS } from '@/lib/ai-privacy';

async function getCustomerWithLogs(ctx: AccessContext, customerId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const [customerSnap, logsSnap] = await Promise.all([
      db.doc(pathCustomer(ctx, customerId)).get(),
      db.collection(pathCustomerLogs(ctx, customerId))
        // 顧客ログ(ContactLog)の正準タイムスタンプは `datetime`（`date` フィールドは存在しない）。
        // 旧実装は orderBy('date') で全ログが黙って除外され、AI が直近ログ無しで提案していた。
        // sibling(message/customer-infer-profile/briefing/chat)と揃え datetime に是正。
        .orderBy('datetime', 'desc')
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

    const context = await getCustomerWithLogs(ctx, customerId);

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
      // 顧客の保存済みフリーテキストと、learn-from-text が相手の LINE 履歴から機械抽出して
      // 書き戻した値を読む。攻撃者の書いた文字列が 1 ホップ挟んで届く経路（P130）
      content = await generateText(
        `${wrapUntrustedInput(context, '顧客データ')}\n\n直前のログ種別: ${lastLogType || '不明'}\n\n次のアクションを提案してください。`,
        {
          systemInstruction: withInjectionGuard(`あなたはNoxaのAIアドバイザーです。
ログ入力後に次のアクションを提案します。

出力形式（JSON）:
{
  "nextAction": "推奨する次のアクション（20文字以内）",
  "timing": "推奨タイミング（例: 3日後、来週、今週末）",
  "reason": "提案理由（30文字以内）",
  "messageIdea": "LINEメッセージのアイデア（50文字以内、省略可）"
}`),
          maxOutputTokens: 300,
          temperature: 0.7,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, suggestCost, reserved);
      throw err;
    }
    let suggestion;
    try {
      suggestion = JSON.parse(content);
    } catch (e) {
      // 生成物が読めないときに**固定の日本語文言**を AI の提案として返していた（Day116-PM2）。
      // 「フォロー連絡 / 3日後 / 関係維持のため」はモデルが一度も言っていない**捏造**で、
      // しかもクレジットは消費済み＝利用者は課金されたうえで、当たり障りのない偽の提案を
      // 本物として受け取り、それを根拠に接客判断をしてしまう。
      // sibling（briefing / seating-suggest / insights-narrative）と同じく失敗として扱い、返金する。
      console.error('[api/ai/suggest] 生成物が JSON として読めず 500。raw head:', (content ?? '').slice(0, 200), e);
      await refundAiCredit(uid, suggestCost, reserved);
      return NextResponse.json({ error: '提案の生成に失敗しました' }, { status: 500 });
    }
    // 消費の記録は生成が成立してから（失敗時は上で返金している）
    void logAiLedger(uid, 'suggest', suggestCost);

    return NextResponse.json({
      suggestion,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    // 入口を通った後に停止へ切り替わると安全網が throw する。裸の 500 にせず
    // `code: AI_DISABLED` を必ず載せる（P154）
    const aiStopped = aiDisabledResponse(error);
    if (aiStopped) return aiStopped;
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI suggest error:', error);
    return NextResponse.json({ error: '提案生成失敗' }, { status: 500 });
  }
}
