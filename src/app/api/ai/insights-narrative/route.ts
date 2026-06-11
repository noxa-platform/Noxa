// /insights ページのセグメント分析結果を AI で解説 + 推奨アクションを 2 つに絞る。
//
// クライアント側で既に segments / trends / recommendedActions を計算済みの前提で、
// それを AI に投げて「今週やるべき動き」を short narrative にまとめてもらう。
// 元の RecommendedAction より絞り込んだ「次の 1 手」を返す設計。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';
import { generateText } from '../ai-provider';
import { resolveWorkspaceContext, composePlaybookAndSelf } from '@/lib/ai-knowledge/prompt-helpers';

interface NarrativeRequestBody {
  workspaceId: string;
  /** 集計済みセグメント分布（クライアント計算済み） */
  segmentCounts: { vip: number; needs_follow: number; growing: number; new_or_dormant: number };
  /** 各セグメントから 1〜2 名のサンプル顧客名（プライバシー: 苗字なし・ニックネームのみ） */
  sampleNames?: Partial<Record<'vip' | 'needs_follow' | 'growing' | 'new_or_dormant', string[]>>;
  /** 平均接触頻度（trend が増えている / 減っている / 横ばい） */
  trendSummary?: { increasing: number; stable: number; decreasing: number };
}

interface NarrativeResponse {
  summary: string;       // 全体俯瞰の 1〜2 文
  actions: { title: string; reason: string }[]; // 絞り込んだ次の 1 手（最大 2 個）
}

const SYSTEM_INSTRUCTION = `あなたはホスト/キャスト向けの売上アドバイザーです。
提供される RFM 風のセグメント分布から、「今週やるべき動き」を 2 つに絞って返してください。

必ず厳密な JSON のみで返答し、フィールドは以下:
{
  "summary": "全体の状態を 1〜2 文で（80 字以内）",
  "actions": [
    { "title": "短い行動命題（20 字以内）", "reason": "なぜそれをやるべきか（60 字以内）" }
  ]
}

ルール:
- actions は最大 2 個、最低 1 個
- 数値は提供されたデータ範囲を超えて捏造しない
- 「全員に LINE を送る」のような曖昧アドバイスは禁止、必ず対象セグメントを特定
- 売上 N 倍などの効果数値は出さない（景表法回避）
- 友達口調 / 営業口調などは添えてもよいが、命令調・断定調は避ける`;

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = (await request.json().catch(() => ({}))) as NarrativeRequestBody;
    if (!body.workspaceId) {
      return NextResponse.json({ error: 'workspaceId が必要です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, body.workspaceId);

    // 店舗 / 自分プロファイルを system に乗せて文脈を効かせる
    const { storeType, selfData, storeProfile } = await resolveWorkspaceContext(ctx);
    const { combined } = composePlaybookAndSelf({
      storeType,
      compact: true,
      selfData,
      storeProfile,
    });
    const systemInstruction = `${SYSTEM_INSTRUCTION}\n\n${combined}`;

    const userPrompt = `# 現在のセグメント分布
- VIP: ${body.segmentCounts.vip} 名
- フォロー必要: ${body.segmentCounts.needs_follow} 名
- 育成中: ${body.segmentCounts.growing} 名
- 新規 or 休眠: ${body.segmentCounts.new_or_dormant} 名

${body.trendSummary
  ? `# 接触頻度トレンド
- 増加: ${body.trendSummary.increasing} 名
- 横ばい: ${body.trendSummary.stable} 名
- 減少: ${body.trendSummary.decreasing} 名`
  : ''}

${body.sampleNames
  ? `# サンプル顧客（参考）
${(['vip', 'needs_follow', 'growing', 'new_or_dormant'] as const)
  .map((seg) => {
    const names = body.sampleNames?.[seg];
    if (!names || names.length === 0) return null;
    return `- ${seg}: ${names.slice(0, 3).join('、')}`;
  })
  .filter(Boolean)
  .join('\n')}`
  : ''}

上記から「今週やるべき動き」を JSON で返してください。`;

    const raw = await generateText(userPrompt, {
      systemInstruction,
      maxOutputTokens: 600,
      temperature: 0.4,
      responseMimeType: 'application/json',
    });

    let parsed: NarrativeResponse = { summary: '', actions: [] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* noop */
        }
      }
    }

    return NextResponse.json(parsed);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('insights-narrative failed:', error);
    return NextResponse.json({ error: '解説生成に失敗しました' }, { status: 500 });
  }
}
