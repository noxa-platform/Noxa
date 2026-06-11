import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { withReservedCredits } from '../with-credits';
import {
  getAdminDb,
  verifyRequest,
  verifyWorkspaceAccess,
  AuthError,
} from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { estimateAiCost } from '@/lib/ai-cost';

// 顧客 1 件の過去ログ + 既存プロフィールを AI に渡し、
// AI 学習フィールド（MBTI / トリガー / トーン / 文体 等）を推定して返す。
// 既存値は **上書きせず、候補として返す**。採用判定は呼び出し側が UI で行う。
//
// 入力:
//  - workspaceId, customerId
//
// 出力 (JSON):
//  - inferred: { mbti, personalityTraits, interests, triggerPositive,
//                triggerNegative, communicationStyle, likesNote, dislikesNote,
//                ngNote, importantMemo, customerPersonality, myMessageStyle,
//                myStyleForCustomer: { tone, emojiLevel, signaturePhrases, notes } }
//  - basedOnLogs: 推定材料に使ったログ件数
//  - creditsRemaining

interface CustomerDoc {
  name?: string;
  rank?: string | null;
  tags?: string[];
  birthday?: string | null;
  mbti?: string | null;
  personalityTraits?: string[];
  interests?: string[];
  triggerPositive?: string[];
  triggerNegative?: string[];
  communicationStyle?: string;
  likesNote?: string;
  dislikesNote?: string;
  ngNote?: string;
  importantMemo?: string;
  customerPersonality?: string;
  myMessageStyle?: string;
}

interface LogDoc {
  type?: string;
  visitType?: string | null;
  datetime?: { _seconds?: number } | { seconds?: number };
  place?: string;
  memo?: string;
  reaction?: string | null;
  rating?: number | null;
  salesAmount?: number;
  giftGiven?: string | null;
  giftReceived?: string | null;
  withDouhan?: boolean;
  withAfter?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const workspaceId: string | undefined = body?.workspaceId;
    const customerId: string | undefined = body?.customerId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    if (!customerId) {
      return NextResponse.json({ error: 'customerId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const db = getAdminDb();
    const customerSnap = await db
      .doc(`shop_shops/${workspaceId}/customers/${customerId}`)
      .get();
    if (!customerSnap.exists) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
    }
    const customer = customerSnap.data() as CustomerDoc;

    // 最新 60 件まで（古すぎるログは AI 推定にノイズが乗る）
    const logsSnap = await db
      .collection(`shop_shops/${workspaceId}/customers/${customerId}/logs`)
      .orderBy('datetime', 'desc')
      .limit(60)
      .get();
    const logs: LogDoc[] = logsSnap.docs.map((d) => d.data() as LogDoc);

    if (logs.length === 0) {
      return NextResponse.json(
        { error: 'この顧客には接触ログがありません。ログを 3 件以上記録してから再度お試しください。' },
        { status: 400 },
      );
    }

    // AI 用に時系列順（古い→新しい）に並べ替え、要約形式に圧縮
    const logsForAi = logs
      .slice()
      .reverse()
      .map((l, i) => {
        const parts: string[] = [`#${i + 1} ${l.type || 'other'}`];
        if (l.visitType) parts.push(`visitType=${l.visitType}`);
        if (l.place) parts.push(`場所=${l.place}`);
        if (l.salesAmount) parts.push(`売上=${l.salesAmount}`);
        if (l.withDouhan) parts.push('同伴');
        if (l.withAfter) parts.push('アフター');
        if (l.giftGiven) parts.push(`贈った=${l.giftGiven}`);
        if (l.giftReceived) parts.push(`貰った=${l.giftReceived}`);
        if (l.rating != null) parts.push(`★${l.rating}`);
        else if (l.reaction) parts.push(`reaction=${l.reaction}`);
        if (l.memo) parts.push(`memo:「${l.memo.slice(0, 200)}」`);
        return parts.join(' / ');
      })
      .join('\n');

    const profileForAi = JSON.stringify(
      {
        name: customer.name,
        rank: customer.rank,
        tags: customer.tags,
        birthday: customer.birthday,
        mbti_current: customer.mbti,
        personalityTraits_current: customer.personalityTraits,
        interests_current: customer.interests,
        triggerPositive_current: customer.triggerPositive,
        triggerNegative_current: customer.triggerNegative,
        communicationStyle_current: customer.communicationStyle,
        likesNote_current: customer.likesNote,
        dislikesNote_current: customer.dislikesNote,
        ngNote_current: customer.ngNote,
        importantMemo_current: customer.importantMemo,
        customerPersonality_current: customer.customerPersonality,
        myMessageStyle_current: customer.myMessageStyle,
      },
      null,
      2,
    );

    // クレジットコスト（接触ログ件数に応じてスケール）
    const inputText = profileForAi + logsForAi;
    const cost = estimateAiCost({
      inputText,
      expectedOutputTokens: 1200,
      featureMultiplier: 1.4,
      maxCap: 8,
    });

    return await withReservedCredits(uid, cost, async ({ ack, remaining }) => {
      const raw = await generateText(
        `## 既存プロフィール\n${profileForAi}\n\n## 接触ログ（古い → 新しい）\n${logsForAi}\n\n上記から、この顧客の AI 学習フィールドを推定してください。判断材料が薄い項目は null / 空配列で返してください。`,
        {
          systemInstruction: `あなたはホスト・キャバ嬢の顧客台帳ナレッジ抽出 AI です。
過去の接触ログと既存プロフィールから、顧客の人物像と返信文体の方針を推定して JSON で返します。

ルール:
- 不確実な情報は推測せず null / 空配列で返す
- 既存値（"_current" 付き）が信頼できるなら踏襲して構わないが、より良い表現が見つかれば改善案を出す
- "interests" は固有名詞・カテゴリ（例: ['競馬','韓国ドラマ']）
- "triggerPositive" は会話を盛り上げる話題（例: ['仕事の自慢話','息子の話']）
- "triggerNegative" は避けるべき話題（例: ['元カノ','政治']）— 単なる NG（アレルギー等）は ngNote へ
- "communicationStyle" は 1〜2 文の自由記述（例: '短文・即レス・絵文字多め'）
- "myStyleForCustomer.tone" は「自分→相手」の文体（例: 'タメ口ベース、たまに敬語'）
- "myStyleForCustomer.emojiLevel" は 'none' | 'low' | 'mid' | 'high'
- "myStyleForCustomer.signaturePhrases" はよく使う言い回し（3 件以内）

出力形式 (JSON、すべてのキーは必須):
{
  "mbti": "INTJ など / 不明なら null",
  "personalityTraits": ["3〜5 項目"],
  "interests": ["3〜5 項目"],
  "triggerPositive": ["2〜4 項目"],
  "triggerNegative": ["1〜3 項目"],
  "communicationStyle": "1 行の文",
  "likesNote": "好み詳細（200 字以内、空なら ''）",
  "dislikesNote": "嫌い詳細（200 字以内、空なら ''）",
  "ngNote": "アレルギー・絶対 NG（100 字以内、空なら ''）",
  "importantMemo": "最重要メモ（150 字以内、空なら ''）",
  "customerPersonality": "顧客性格の要約 1〜2 文",
  "myMessageStyle": "自分の返信文体の要約 1〜2 文",
  "myStyleForCustomer": {
    "tone": "自分→相手の文体",
    "emojiLevel": "none|low|mid|high",
    "signaturePhrases": ["3 件以内"],
    "notes": "補足、空なら ''"
  },
  "confidence": "low|medium|high (ログが少なければ low)",
  "summary": "なぜこの推定になったか 1 文"
}`,
          maxOutputTokens: 1500,
          temperature: 0.5,
          responseMimeType: 'application/json',
          modelTier: 'flash',
        },
      );

      let inferred: Record<string, unknown> = {};
      try {
        inferred = JSON.parse(raw);
      } catch {
        inferred = { summary: raw, confidence: 'low' };
      }

      ack();
      return NextResponse.json({
        inferred,
        basedOnLogs: logs.length,
        creditsRemaining: remaining,
      });
    }, 'customer-infer-profile');
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI customer-infer-profile error:', error);
    return NextResponse.json({ error: '推定に失敗しました' }, { status: 500 });
  }
}
