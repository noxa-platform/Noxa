/**
 * LINE ログイン（Custom Token 方式）。
 *
 * Firebase Auth は LINE をネイティブ対応しないため、LINE Login(OAuth2.1) の
 * 認可コードをサーバで検証し、対応する Firebase ユーザーの Custom Token を発行する。
 * クライアントは signInWithCustomToken で session を確立する。
 *
 * 連携方針: LINE が email を返す場合は同一 email の既存 Firebase ユーザーに統合
 * （1 ユーザー = 1 NOXA アカウント）。email が無い場合は uid=line_<lineUserId> で作成。
 *
 * 必要な環境変数（Functions secret 推奨）:
 *   - LINE_CHANNEL_ID
 *   - LINE_CHANNEL_SECRET
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp } from './admin';

// node20 グローバル fetch（functions の lib に dom が無いため最小宣言）
declare const fetch: (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<Record<string, unknown>> }>;

const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

const ALLOWED_ORIGINS = [
  'https://noxa.egshugy.com',
  'https://noxa-delta.vercel.app',
  'http://localhost:3000',
  'http://localhost:3100',
];

function adminAuth() {
  return getAuth(getAdminApp());
}

function applyCors(res: { setHeader: (k: string, v: string) => void }, origin: string | undefined) {
  if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
}

const form = (params: Record<string, string>) =>
  Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

export const lineLogin = onRequest({ cors: false, region: 'asia-northeast1', invoker: 'public', secrets: ['LINE_CHANNEL_ID', 'LINE_CHANNEL_SECRET'] }, async (req, res) => {
  applyCors(res, req.headers.origin as string | undefined);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }

  try {
    // Web: { code, redirectUri }（認可コードフロー）/ ネイティブ(iOS LINE SDK): { idToken } を直接受け付ける
    const body = (req.body ?? {}) as { code?: string; redirectUri?: string; idToken?: string };

    const channelId = process.env.LINE_CHANNEL_ID;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelId || !channelSecret) { logger.error('[lineLogin] LINE_CHANNEL_ID/SECRET 未設定'); res.status(500).json({ error: 'NOT_CONFIGURED' }); return; }

    let idToken = (body.idToken ?? '').trim();
    if (!idToken) {
      // 1) Web: 認可コード → トークン交換（client_secret はサーバのみ保持）
      const code = (body.code ?? '').trim();
      const redirectUri = (body.redirectUri ?? '').trim();
      if (!code || !redirectUri) { res.status(400).json({ error: 'BAD_REQUEST' }); return; }
      const tokenRes = await fetch(LINE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: channelId, client_secret: channelSecret }),
      });
      if (!tokenRes.ok) { logger.error('[lineLogin] token exchange failed', await tokenRes.text()); res.status(401).json({ error: 'TOKEN_EXCHANGE_FAILED' }); return; }
      const tokenJson = await tokenRes.json();
      idToken = typeof tokenJson.id_token === 'string' ? tokenJson.id_token : '';
    }
    if (!idToken) { res.status(401).json({ error: 'NO_ID_TOKEN' }); return; }

    // 2) id_token を LINE で検証（署名・aud・exp を LINE 側で確認）
    const verifyRes = await fetch(LINE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ id_token: idToken, client_id: channelId }),
    });
    if (!verifyRes.ok) { logger.error('[lineLogin] verify failed', await verifyRes.text()); res.status(401).json({ error: 'VERIFY_FAILED' }); return; }
    const profile = await verifyRes.json(); // { sub, name?, picture?, email? }

    const lineUserId = typeof profile.sub === 'string' ? profile.sub : '';
    if (!lineUserId) { res.status(401).json({ error: 'NO_SUBJECT' }); return; }
    const email = typeof profile.email === 'string' ? profile.email : undefined;
    const name = typeof profile.name === 'string' ? profile.name : undefined;
    const picture = typeof profile.picture === 'string' ? profile.picture : undefined;

    // 3) uid 解決（email 一致なら既存アカウントに統合）
    const auth = adminAuth();
    let uid = `line_${lineUserId}`;
    if (email) {
      try { const existing = await auth.getUserByEmail(email); uid = existing.uid; } catch { /* 既存なし → line_ uid で新規 */ }
    }

    // 4) Firebase ユーザーを作成/更新
    const userProps = {
      ...(email ? { email } : {}),
      ...(name ? { displayName: name } : {}),
      ...(picture ? { photoURL: picture } : {}),
    };
    try {
      await auth.updateUser(uid, userProps);
    } catch {
      await auth.createUser({ uid, ...userProps });
    }

    const customToken = await auth.createCustomToken(uid, { line: true });
    res.status(200).json({ customToken });
  } catch (e) {
    logger.error('[lineLogin] failed', e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});
