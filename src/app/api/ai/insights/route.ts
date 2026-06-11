import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '../ai-provider';
import { reserveAiCredit, refundAiCredit, logAiLedger } from '../../lib/credits';
import { estimateAiCost } from '@/lib/ai-cost';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';

async function getWorkspaceData(workspaceId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const snap = await db.collection(`shop_shops/${workspaceId}/customers`).get();
    if (snap.empty) return '[]';

    const customers = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        name: d.name || '不明',
        totalSales: d.totalSales || 0,
        rank: d.rank || null,
        birthday: d.birthday || null,
        tags: d.tags || [],
        likes: d.likesNote || '',
        importantMemo: d.importantMemo || '',
      };
    });

    return JSON.stringify(customers);
  } catch (e) {
    console.error('getWorkspaceData error:', e);
    return '[]';
  }
}

// 冷え検知用: 各顧客の直近会話 mood を集計
async function getRelationshipRiskData(workspaceId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const snap = await db.collection(`shop_shops/${workspaceId}/customers`).get();
    if (snap.empty) return '[]';

    const now = Date.now();
    const targets = snap.docs.map((doc) => {
      const d = doc.data();
      const history = (d.chatHistory || []) as { sender: string; mood?: string; text: string }[];
      // 相手発言の直近10件を抽出
      const customerMsgs = history.filter((h) => h.sender === 'customer').slice(-10);
      if (customerMsgs.length === 0) return null;

      const moodCounts = { positive: 0, neutral: 0, negative: 0 };
      for (const m of customerMsgs) {
        const mood = m.mood || 'neutral';
        if (mood in moodCounts) moodCounts[mood as keyof typeof moodCounts]++;
      }

      const lastContactAt = d.lastContactAt?.toDate?.();
      const daysSinceContact = lastContactAt
        ? Math.floor((now - lastContactAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        name: d.name || '不明',
        rank: d.rank || null,
        totalSales: d.totalSales || 0,
        lastMood: customerMsgs[customerMsgs.length - 1]?.mood || 'neutral',
        moodCounts,
        messageCount: customerMsgs.length,
        daysSinceContact,
      };
    }).filter(Boolean);

    return JSON.stringify(targets);
  } catch (e) {
    console.error('getRelationshipRiskData error:', e);
    return '[]';
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { workspaceId, type } = await request.json().catch(() => ({}));

    if (!workspaceId) {
      return NextResponse.json({ error: 'パラメータ不足' }, { status: 400 });
    }

    const ctx = await resolveAccessContext(uid, workspaceId);

    const customerData = type === 'relationship_risk'
      ? await getRelationshipRiskData(workspaceId)
      : await getWorkspaceData(workspaceId);

    // 顧客データ量に応じて見積もり（多いほどコスト増、THINK 系扱いで倍率 1.5）
    // customerData は既に JSON.stringify 済みの string なので二重 stringify しない
    const insightsCost = estimateAiCost({
      inputText: customerData,
      expectedOutputTokens: 1500,
      thinkMode: true, // 関係性リスク分析は推論強め扱い
      featureMultiplier: 1.5,
    });
    const reserved = await reserveAiCredit(uid, insightsCost);
    if (!reserved.ok) {
      return NextResponse.json({ error: 'AIクレジット不足', creditsRemaining: reserved.remaining, requiredCredits: insightsCost }, { status: 429 });
    }

    const prompts: Record<string, string> = {
      trends: `顧客データを分析してください。必ず以下の正確なJSON形式で出力してください。説明文や前置きは不要です。
{
  "topCustomers": [{"name": "名前", "sales": 金額, "trend": "上昇/横ばい/下降"}],
  "insights": ["インサイト1", "インサイト2", "インサイト3"],
  "recommendations": ["推奨アクション1", "推奨アクション2"]
}`,
      customer: `各顧客の傾向を分析してください。必ず以下の正確なJSON形式で出力してください。説明文や前置きは不要です。
{
  "segments": [
    {"label": "セグメント名", "customers": ["名前1", "名前2"], "description": "説明"}
  ],
  "atRisk": [{"name": "名前", "reason": "離反リスクの理由"}],
  "growthOpportunity": [{"name": "名前", "suggestion": "育成提案"}]
}`,
      predict: `過去の顧客データから今後の売上を予測してください。必ず以下の正確なJSON形式で出力してください。説明文や前置きは不要です。
{
  "predictedMonthlySales": 予測金額,
  "confidence": "高/中/低",
  "factors": ["要因1", "要因2"],
  "suggestions": ["改善提案1", "改善提案2"]
}`,
      relationship_risk: `各顧客の直近会話の mood（positive/neutral/negative）と接触日数から、関係性が冷えているリスクを抽出してください。
以下の正確なJSON形式で出力してください。説明文や前置きは不要です。
{
  "coolingDown": [
    {"name": "名前", "severity": "高/中/低", "signals": ["ポジティブ率低下", "30日接触なし" 等], "suggestedAction": "推奨アクション"}
  ],
  "warming": [
    {"name": "名前", "reason": "直近のポジティブな変化"}
  ],
  "urgentContact": ["今日中に連絡すべき顧客名1", "顧客名2"]
}

判定基準:
- negative 率が 30% 超 → severity 高
- negative + neutral で positive が 0 → severity 中
- 直近 negative 発言 + 接触から 20日以上 → severity 高
- 直近 positive 連続 → warming に入れる
- severity 高 は urgentContact にも入れる`,
    };

    const prompt = prompts[type] || prompts.trends;

    let content: string;
    try {
      content = await generateText(
        `顧客データ:\n${customerData}\n\n${prompt}`,
        {
          systemInstruction: 'あなたはNoxaのデータ分析AIです。ホスト/ホステスの顧客データを分析して実用的なインサイトを提供します。必ず有効なJSON形式のみで出力してください。前置きや説明文は一切不要です。',
          maxOutputTokens: 1000,
          temperature: 0.3,
          responseMimeType: 'application/json',
        }
      );
    } catch (err) {
      await refundAiCredit(uid, insightsCost);
      throw err;
    }

    // JSONパース失敗時は予約クレジットを返却
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('AI insights JSON parse failed (content length:', content.length, ')');
      await refundAiCredit(uid, insightsCost);
      return NextResponse.json(
        { error: '分析結果のパースに失敗しました。再度お試しください。' },
        { status: 500 }
      );
    }
    void logAiLedger(uid, 'insights', insightsCost);

    return NextResponse.json({
      data: parsed,
      creditsRemaining: reserved.remaining,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('AI insights error:', error);
    return NextResponse.json({ error: 'インサイト生成失敗' }, { status: 500 });
  }
}
