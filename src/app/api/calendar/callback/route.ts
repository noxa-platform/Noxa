import { NextRequest, NextResponse } from 'next/server';
import { saveTokenDoc } from '../lib';

// Google OAuth コールバック: 認証コード → トークン交換 → Firestore保存
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/calendar/connect?error=no_code', request.url));
  }

  try {
    // 認証コードをトークンに交換
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${request.nextUrl.origin}/api/calendar/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('トークン交換失敗:', err);
      return NextResponse.redirect(new URL('/calendar/connect?error=token_exchange', request.url));
    }

    const tokens = await tokenRes.json();

    // stateパラメータからuidを取得
    const state = request.nextUrl.searchParams.get('state') || '';
    const uid = state;

    if (!uid) {
      return NextResponse.redirect(new URL('/calendar/connect?error=no_uid', request.url));
    }

    // Firestoreにトークン保存（REST API経由）
    await saveTokenDoc(uid, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      expiresIn: tokens.expires_in,
    });

    return NextResponse.redirect(new URL('/calendar?connected=true', request.url));
  } catch (error) {
    console.error('OAuth callback エラー:', error);
    return NextResponse.redirect(new URL('/calendar/connect?error=unknown', request.url));
  }
}
