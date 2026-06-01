// ミッション一覧 + 進捗 + 残数の状況取得 API。
//
// クライアントはこのエンドポイントの結果をホームのミッションカードに表示する。
// 各ミッションの達成条件は基本的にサーバー側で発火するので、ここでは「受領済みか」
// のみ返す（達成判定は呼び出し側の API でリアルタイムに行う）。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../lib/firebase-admin';
import { MISSIONS, totalRewardCredits } from '@/lib/missions';
import { getClaimedMissionIds } from './lib';

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const claimed = await getClaimedMissionIds(uid);

    const items = MISSIONS.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      category: m.category,
      rewardCredits: m.rewardCredits,
      order: m.order,
      claimed: claimed.has(m.id),
    })).sort((a, b) => a.order - b.order);

    const claimedCredits = items
      .filter((i) => i.claimed)
      .reduce((acc, i) => acc + i.rewardCredits, 0);

    return NextResponse.json({
      missions: items,
      summary: {
        completed: items.filter((i) => i.claimed).length,
        total: items.length,
        claimedCredits,
        totalCredits: totalRewardCredits(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('missions GET error:', error);
    return NextResponse.json({ error: 'ミッション取得に失敗しました' }, { status: 500 });
  }
}
