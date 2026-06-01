import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '../../../lib/firebase-admin';

// LINE OAuth コールバック → Firebase Custom Tokenを生成してログイン
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const savedState = request.cookies.get('line_oauth_state')?.value;
    const origin = request.nextUrl.origin;

    // CSRF検証
    if (!code || !state || state !== savedState) {
      return NextResponse.redirect(`${origin}/login?error=LINE認証に失敗しました`);
    }

    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
    if (!channelId || !channelSecret) {
      return NextResponse.redirect(`${origin}/login?error=LINE Login未設定`);
    }

    // 認可コードをアクセストークンに交換
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${origin}/api/auth/line/callback`,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    if (!tokenRes.ok) {
      console.error('LINE token exchange error:', await tokenRes.text());
      return NextResponse.redirect(`${origin}/login?error=LINEトークン取得に失敗しました`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // LINEプロフィール取得
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(`${origin}/login?error=LINEプロフィール取得に失敗しました`);
    }

    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName || '';
    const pictureUrl = profile.pictureUrl || '';

    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    // 既存ユーザーをLINE UserIDで検索
    let uid: string | null = null;

    const profileSnap = await db.collection('account_users')
      .where('lineLoginUserId', '==', lineUserId)
      .limit(1)
      .get();

    if (!profileSnap.empty) {
      // 既存ユーザーにログイン
      uid = profileSnap.docs[0].id;
    } else {
      // 新規ユーザー作成
      const newUser = await adminAuth.createUser({
        displayName,
        photoURL: pictureUrl || undefined,
      });
      uid = newUser.uid;

      // プロフィールにLINE情報を保存
      await db.doc(`account_users/${uid}`).set({
        lineLoginUserId: lineUserId,
        stageName: displayName,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });
    }

    // Firebase Custom Token生成
    const customToken = await adminAuth.createCustomToken(uid);

    // 旧実装は URL query で Custom Token を渡していたが、ブラウザ履歴・Referer・
    // サーバーログ経由の漏洩リスクがあるため httpOnly cookie に変更。
    // /api/auth/line/finalize で一度だけ取り出して即削除する。
    const response = NextResponse.redirect(`${origin}/login?lineLogin=ok`);
    response.cookies.set('yl_line_token', customToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60, // 60 秒以内に finalize されない場合は無効化
    });
    response.cookies.delete('line_oauth_state');
    return response;
  } catch (error) {
    console.error('LINE callback error:', error);
    const origin = request.nextUrl.origin;
    return NextResponse.redirect(`${origin}/login?error=LINE認証に失敗しました`);
  }
}
