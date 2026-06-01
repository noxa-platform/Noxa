// Google OAuthトークンの取得・リフレッシュ
// Firebase Admin SDKでセキュリティルールをバイパス
import { getAdminDb } from '../lib/firebase-admin';

interface TokenDoc {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

// Firestoreからトークンを取得
async function getTokenDoc(uid: string): Promise<TokenDoc | null> {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`account_google_tokens/${uid}`).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    return {
      accessToken: d.accessToken || '',
      refreshToken: d.refreshToken || '',
      expiresAt: d.expiresAt?.toDate?.()?.toISOString?.() || d.expiresAt || '',
    };
  } catch (e) {
    console.error('getTokenDoc error:', e);
    return null;
  }
}

// Firestoreにトークンを保存
export async function saveTokenDoc(uid: string, data: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): Promise<void> {
  const db = getAdminDb();
  await db.doc(`account_google_tokens/${uid}`).set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: new Date(Date.now() + data.expiresIn * 1000),
    updatedAt: new Date(),
  }, { merge: true });
}

// 有効なアクセストークンを取得（期限切れならリフレッシュ）
export async function getValidToken(uid: string): Promise<string | null> {
  const tokenDoc = await getTokenDoc(uid);
  if (!tokenDoc) return null;

  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) > new Date()) {
    return tokenDoc.accessToken;
  }

  if (!tokenDoc.refreshToken) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: tokenDoc.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) return null;

    const tokens = await res.json();
    await saveTokenDoc(uid, {
      accessToken: tokens.access_token,
      refreshToken: tokenDoc.refreshToken,
      expiresIn: tokens.expires_in,
    });

    return tokens.access_token;
  } catch (e) {
    console.error('getValidToken refresh error:', e);
    return null;
  }
}
