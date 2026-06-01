import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';

// LINE Login OAuth開始 → LINEの認可画面にリダイレクト
export async function GET(request: NextRequest) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    return NextResponse.json({ error: 'LINE Login未設定' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/line/callback`;
  const state = crypto.randomBytes(16).toString('hex');

  // stateをcookieに保存（CSRF対策）
  const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', channelId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'profile openid');

  const response = NextResponse.redirect(url.toString());
  response.cookies.set('line_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10分
    path: '/',
  });

  return response;
}
