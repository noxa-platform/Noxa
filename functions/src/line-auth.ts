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
import { db, getAdminApp } from './admin';

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
    // 受付3モード:
    //   Web         : { code, redirectUri }（認可コードフロー）
    //   iOS(idToken): { idToken }（LINE SDK の ID トークン。email も取れる）
    //   iOS(SDK)    : { accessToken }（LINE SDK のアクセストークン。/v2/profile で取得・email なし）
    const body = (req.body ?? {}) as { code?: string; redirectUri?: string; idToken?: string; accessToken?: string };

    const channelId = process.env.LINE_CHANNEL_ID;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelId || !channelSecret) { logger.error('[lineLogin] LINE_CHANNEL_ID/SECRET 未設定'); res.status(500).json({ error: 'NOT_CONFIGURED' }); return; }

    let lineUserId = '';
    let email: string | undefined;
    let name: string | undefined;
    let picture: string | undefined;

    const accessToken = (body.accessToken ?? '').trim();
    if (accessToken) {
      // ネイティブ: アクセストークンでプロフィール取得（email は含まれない）
      const pr = await fetch('https://api.line.me/v2/profile', { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      if (!pr.ok) { logger.error('[lineLogin] profile failed', await pr.text()); res.status(401).json({ error: 'PROFILE_FAILED' }); return; }
      const p = await pr.json(); // { userId, displayName?, pictureUrl? }
      lineUserId = typeof p.userId === 'string' ? p.userId : '';
      name = typeof p.displayName === 'string' ? p.displayName : undefined;
      picture = typeof p.pictureUrl === 'string' ? p.pictureUrl : undefined;
    } else {
      let idToken = (body.idToken ?? '').trim();
      if (!idToken) {
        // Web: 認可コード → トークン交換（client_secret はサーバのみ保持）
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

      // id_token を LINE で検証（署名・aud・exp を LINE 側で確認）
      const verifyRes = await fetch(LINE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ id_token: idToken, client_id: channelId }),
      });
      if (!verifyRes.ok) { logger.error('[lineLogin] verify failed', await verifyRes.text()); res.status(401).json({ error: 'VERIFY_FAILED' }); return; }
      const profile = await verifyRes.json(); // { sub, name?, picture?, email? }
      lineUserId = typeof profile.sub === 'string' ? profile.sub : '';
      email = typeof profile.email === 'string' ? profile.email : undefined;
      name = typeof profile.name === 'string' ? profile.name : undefined;
      picture = typeof profile.picture === 'string' ? profile.picture : undefined;
    }

    if (!lineUserId) { res.status(401).json({ error: 'NO_SUBJECT' }); return; }

    // 3) uid 解決
    const auth = adminAuth();
    let uid = `line_${lineUserId}`;
    let resolved = false;
    // 3-1) 統合済み LINE マッピング（account_users.lineUserId）を最優先
    try {
      const m = await db().collection('account_users').where('lineUserId', '==', lineUserId).limit(1).get();
      if (!m.empty) { uid = m.docs[0].id; resolved = true; }
    } catch { /* index 等の問題は無視して次へ */ }
    // 3-2) email 一致なら既存アカウントに統合
    if (!resolved && email) {
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
