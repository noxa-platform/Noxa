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
/**
 * 秘密鍵が無いときは**署名も検証もしない**（Day111-PM）。
 * 旧実装は鍵が空文字でも HMAC を計算していたため、鍵未設定のデプロイでは
 * 「誰でも正しい署名を作れる」＝ CSRF 対策が実質無効な状態で**通ってしまう**
 * （攻撃者が任意 uid の署名 state を鍛造でき、被害者のトークン doc を上書きできる）。
 * 発行側は例外にして 500 で気づかせ、検証側は fail-closed（null）にする。
 */
export class CalendarStateSecretMissing extends Error {
  constructor() { super('CALENDAR_STATE_SECRET (or GOOGLE_CLIENT_SECRET) is not configured'); }
}
export function signState(uid: string): string {
  if (!stateSecret()) throw new CalendarStateSecretMissing();
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** 署名 state を検証して uid を返す（不正/失効は null） */
export function verifyState(state: string): string | null {
  if (!stateSecret()) return null; // 鍵が無い＝誰でも鍛造できるので一切受理しない
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
//
// refreshToken が空のときは**そのフィールドを書かない**（Day111）。
// Google は再同意なしの再連携で refresh_token を返さないことがあり、旧実装はそれを空文字で
// 上書きしていた。すると保存直後は動くが、アクセストークンが失効した瞬間に
// `getValidToken` が「refreshToken 無し → null」となり、**連携が無言で死ぬ**
// （画面には「カレンダー0件」と出るだけで、再連携が必要なことは伝わらない）。
export async function saveTokenDoc(uid: string, data: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): Promise<void> {
  const db = getAdminDb();
  await db.doc(`account_google_tokens/${uid}`).set({
    accessToken: data.accessToken,
    ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
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

  if (!tokenDoc.refreshToken) {
    // 連携 doc はあるのに更新できない＝**連携済みの表示のまま予定が出ない**状態。
    // 呼び出し元には null しか渡らないので、ここで残さないと誰も気づけない（Day116-PM2）
    console.error('[calendar/lib] refreshToken が無く再取得できません（要・再連携）:', uid);
    return null;
  }

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

    if (!res.ok) {
      // invalid_grant（利用者が Google 側で連携を取り消した）等。無言だと
      // 「連携済みなのに予定が空」の問い合わせに対して手掛かりがゼロになる（Day116-PM2）
      console.error('[calendar/lib] リフレッシュトークンでの再取得に失敗:', uid, res.status, await res.text().catch(() => ''));
      return null;
    }

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
