import { NextRequest, NextResponse } from 'next/server';
import { saveTokenDoc, verifyState } from '../lib';

// Google OAuth コールバック: 認証コード → トークン交換 → Firestore保存
//
// リダイレクト先は `/account/connections`（Day111）。旧実装は `/calendar` `/calendar/connect` へ
// 戻していたが、**どちらのページも存在しない**（`src/app/calendar` が無い）ため、連携の成否に
// かかわらずユーザーは 404 に着地していた＝成功したのか失敗したのか分からない（Day104-105 の到達性と同型）。
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/account/connections?calendar=no_code', request.url));
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
      return NextResponse.redirect(new URL('/account/connections?calendar=token_exchange', request.url));
    }

    const tokens = await tokenRes.json();
    // 200 でも access_token が欠ける応答があり得る（Google 側のエラー表現）。
    // そのまま保存すると Admin SDK が undefined で例外→「不明なエラー」に化けるので、
    // 原因が伝わる token_exchange として扱う（Day111-PM）
    if (!tokens?.access_token) {
      console.error('トークン交換の応答に access_token がありません');
      return NextResponse.redirect(new URL('/account/connections?calendar=token_exchange', request.url));
    }

    // state から uid を取得（CSRF対策）。
    //   1) /api/calendar/start が発行した HMAC 署名 state を検証（正規経路）
    //   2) 後方互換: 署名形式でない旧来の uid 平文 state は **明示的に opt-in した場合のみ**受理
    //      （CALENDAR_ALLOW_LEGACY_STATE === 'true'）。
    //
    // Day111 で既定を反転した。旧実装は「'false' でない限り受理」＝**未設定の本番で平文 uid が通る**状態で、
    // 攻撃者は `?code=<自分の認可コード>&state=<被害者uid>` を踏ませるだけで
    // **被害者の account_google_tokens を自分のトークンで上書き**できた（＝被害者の予定表が攻撃者のものに
    // すり替わる／被害者の連携が壊れる）。署名 state を発行する `/api/calendar/start` は Day84 から存在し、
    // 本リポと他クライアント（noxa-ios / yorulog-ios / nomishugy）に `/api/calendar/*` の呼び出しは
    // **1件も無い**ことを確認済みのため、既定を締めても壊れる呼び出し元は無い。
    const state = request.nextUrl.searchParams.get('state') || '';
    let uid = verifyState(state);
    if (!uid && process.env.CALENDAR_ALLOW_LEGACY_STATE === 'true' && state && !state.includes('.')) {
      uid = state;
    }

    if (!uid) {
      return NextResponse.redirect(new URL('/account/connections?calendar=invalid_state', request.url));
    }

    // Firestoreにトークン保存（REST API経由）
    await saveTokenDoc(uid, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      expiresIn: tokens.expires_in,
    });

    return NextResponse.redirect(new URL('/account/connections?calendar=connected', request.url));
  } catch (error) {
    console.error('OAuth callback エラー:', error);
    return NextResponse.redirect(new URL('/account/connections?calendar=unknown', request.url));
  }
}
