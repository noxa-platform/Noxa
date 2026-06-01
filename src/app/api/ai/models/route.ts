// AI チャットで選べるモデル一覧を返す（admin 限定）。
//
// 一般ユーザーは FAST/THINK の 2 モード切替のみ。
// admin（isAdmin(email) === true）にはこの API 経由で OpenRouter 経由の
// 全モデルが取れる。クライアント側でモデルピッカーを描画して、
// 性能 vs コストの試行に使う。
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError, getAdminAuth } from '../../lib/firebase-admin';
import { isAdmin } from '@/lib/admin';
import { OPENROUTER_MODELS } from '../openrouter';

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const userRecord = await getAdminAuth().getUser(uid);
    if (!isAdmin(userRecord.email)) {
      return NextResponse.json({ models: [] });
    }
    return NextResponse.json({
      models: OPENROUTER_MODELS,
      enabled: Boolean(process.env.OPENROUTER_API_KEY),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('GET /api/ai/models failed:', error);
    return NextResponse.json({ error: '取得失敗' }, { status: 500 });
  }
}
