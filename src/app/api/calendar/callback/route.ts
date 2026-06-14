import { NextRequest, NextResponse } from 'next/server';
import { saveTokenDoc, verifyState } from '../lib';

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

    // state から uid を取得（CSRF対策）。
    //   1) /api/calendar/start が発行した HMAC 署名 state を優先検証
    //   2) 後方互換: 署名形式でない旧来の uid 平文 state は、CALENDAR_ALLOW_LEGACY_STATE
    //      が 'false' でない限り受理（既存フローを壊さない既定。'false' で署名必須＝完全CSRF防御）
    const state = request.nextUrl.searchParams.get('state') || '';
    let uid = verifyState(state);
    if (!uid && process.env.CALENDAR_ALLOW_LEGACY_STATE !== 'false' && state && !state.includes('.')) {
      uid = state;
    }

    if (!uid) {
      return NextResponse.redirect(new URL('/calendar/connect?error=invalid_state', request.url));
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
