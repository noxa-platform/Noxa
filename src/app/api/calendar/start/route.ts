// Google Calendar OAuth の開始。認証必須ユーザーに、HMAC署名 state 付きの
// 認可URLを返す（CSRF対策）。クライアントはこの url に遷移して同意 → /api/calendar/callback。
//
// GET -> { url }
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest, AuthError } from '../../lib/firebase-admin';
import { signState, CalendarStateSecretMissing } from '../lib';

const SCOPE = 'https://www.googleapis.com/auth/calendar';

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
    if (!clientId) {
      // 同ファイルの CALENDAR_STATE_SECRET 未設定はログを残しているのに、ここだけ無言だった（Day116-PM）
      console.error('[api/calendar/start] NEXT_PUBLIC_GOOGLE_CLIENT_ID 未設定のため連携を開始できません');
      return NextResponse.json({ error: 'Google 連携が未設定です' }, { status: 500 });
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', `${request.nextUrl.origin}/api/calendar/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', signState(uid)); // 署名付き＝偽造不可・10分失効

    return NextResponse.json({ url: url.toString() });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    // 署名鍵が無い＝CSRF 対策が効かない状態なので、認可 URL を発行せずに落とす（Day111-PM）
    if (e instanceof CalendarStateSecretMissing) {
      console.error('[api/calendar/start] CALENDAR_STATE_SECRET 未設定のため連携を開始できません');
      return NextResponse.json({ error: 'Google 連携が未設定です' }, { status: 500 });
    }
    console.error('[api/calendar/start] error:', e);
    return NextResponse.json({ error: '連携の開始に失敗しました' }, { status: 500 });
  }
}
