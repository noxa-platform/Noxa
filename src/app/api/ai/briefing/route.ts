// 「会話前ブリーフィング」API。
//
// 顧客一人を 30 秒で再把握するための AI 生成サマリ。
// 顧客プロファイル + 直近 10 件のログを Gemini に投げて、
// 「今日の話題候補 / 避けるべき / 直近の出来事 / 関係ステージ」を JSON で返す。
//
// クレジット消費: estimateAiCost で動的算出（featureMultiplier 1.2）
import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { estimateAiCost } from '@/lib/ai-cost';
import { withReservedCredits } from '../with-credits';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext, pathCustomer, pathCustomerLogs, type AccessContext } from '../../lib/access-context';

async function getCustomerContext(ctx: AccessContext, customerId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const [customerSnap, logsSnap] = await Promise.all([
      db.doc(pathCustomer(ctx, customerId)).get(),
      db.collection(pathCustomerLogs(ctx, customerId))
        .orderBy('datetime', 'desc')
        .limit(10)
        .get(),
    ]);
    if (!customerSnap.exists) return '{}';
    const customer = customerSnap.data() ?? {};
    const logs = logsSnap.docs.map((d) => {
      const data = d.data();
      return {
        type: data.type,
        datetime: data.datetime?.toDate?.()?.toISOString?.() ?? null,
        memo: data.memo,
        place: data.place,
        salesAmount: data.salesAmount,
        reaction: data.reaction,
        nextAction: data.nextAction,
      };
    });
    return JSON.stringify({
      customer: {
        name: customer.name,
        nameKana: customer.nameKana,
        rank: customer.rank,
        tags: customer.tags,
        mbti: customer.mbti,
        likesNote: customer.likesNote,
        importantMemo: customer.importantMemo,
        customerPersonality: customer.customerPersonality,
        communicationStyle: customer.communicationStyle,
        likes: customer.likes,
        dislikes: customer.dislikes,
        personalityTraits: customer.personalityTraits,
        interests: customer.interests,
        triggerPositive: customer.triggerPositive,
        triggerNegative: customer.triggerNegative,
        totalSales: customer.totalSales,
        lastContactAt: customer.lastContactAt?.toDate?.()?.toISOString?.() ?? null,
        birthday: customer.birthday,
        nextAction: customer.nextAction,
      },
      recentLogs: logs,
    });
  } catch (e) {
    console.error('getCustomerContext error:', e);
    return '{}';
  }
}

const SYSTEM_INSTRUCTION = `あなたは Noxa の AI ブリーフィング担当です。
顧客一人を 30 秒で再把握できるサマリを作ります。

ルール:
- 提供データの事実のみに基づき、推測で埋めない（不明は省く）
- 顧客の名前や個人情報を本文に書きすぎない（プライバシー配慮）
- 営業押し付け表現を使わない
- 「今日の話題候補」は 3 個、相手の興味 / 直近の出来事から具体的に
- 「避けるべき」は地雷話題 / 機嫌悪い兆候から 1-3 個
- 「関係ステージ」は S1-S5 で判定: S1初回 / S2育成 / S3常連 / S4休眠 / S5離反懸念
- 「直近サマリ」は最終接触からの経過と最近の出来事を 60 字以内

JSON 出力形式（必ず厳密 JSON のみ、説明文不要）:
{
  "stage": "S1" | "S2" | "S3" | "S4" | "S5",
  "stageReason": "判定理由を 40 字以内",
  "recentSummary": "直近サマリ 60 字以内",
  "topicCandidates": ["話題1", "話題2", "話題3"],
  "avoidTopics": ["避けるべき1", ...],
  "tipForToday": "今日の接客アドバイス 50 字以内"
}`;

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { workspaceId, customerId } = await request.json();

    if (!workspaceId || !customerId) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    const context = await getCustomerContext(ctx, customerId);

    const cost = estimateAiCost({
      inputText: context,
      expectedOutputTokens: 600,
      featureMultiplier: 1.2,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await generateText(
        `# 顧客情報\n${context}\n\n上記の顧客について、今日の会話前ブリーフィングを JSON で出力してください。`,
        {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 600,
          temperature: 0.4,
          responseMimeType: 'application/json',
          modelTier: 'lite',
        },
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'ブリーフィング生成に失敗しました' }, { status: 500 });
      }

      ack();
      return NextResponse.json({
        briefing: parsed,
        creditsRemaining: remaining,
      });
    }, 'briefing');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI briefing error:', error);
    return NextResponse.json({ error: 'ブリーフィング生成失敗' }, { status: 500 });
  }
}
