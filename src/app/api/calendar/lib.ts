// Google OAuthトークンの取得・リフレッシュ
// Firebase Admin SDKでセキュリティルールをバイパス
import crypto from 'crypto';
import { getAdminDb } from '../lib/firebase-admin';

// ── OAuth state の署名（CSRF対策） ───────────────────────────
// 旧実装は state=uid 平文で、攻撃者が任意 uid のトークン doc を上書きできた。
// HMAC 署名付き state（uid＋失効＋nonce）にして偽造不可にする。開始は /api/calendar/start。
const STATE_TTL_MS = 10 * 60 * 1000; // 10分
function stateSecret(): string {
  return process.env.CALENDAR_STATE_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
}
export function signState(uid: string): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** 署名 state を検証して uid を返す（不正/失効は null） */
export function verifyState(state: string): string | null {
  const i = state.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expSig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { uid?: unknown; exp?: unknown };
    if (typeof p.uid !== 'string' || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p.uid;
  } catch { return null; }
}

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
