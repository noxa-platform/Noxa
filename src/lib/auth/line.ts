'use client';

/**
 * LINE ログイン（クライアント側）。
 * 認可コードフロー: authorize へ redirect → /account/line-callback で受け取り →
 * Cloud Function `lineLogin` に code を渡して Custom Token を取得 → signInWithCustomToken。
 */
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { ensureAccountUser } from '@/lib/auth';

// Channel ID は公開値（authorize URL に載る）。env 未設定でも動くよう既定値を持つ。
const CHANNEL_ID = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID ?? '2010310730';
const FUNCTIONS_BASE = process.env.NEXT_PUBLIC_NOXA_FUNCTIONS_URL ?? 'https://asia-northeast1-noxa-platform.cloudfunctions.net';
const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';

/** LINE ログインが利用可能か（チャネル ID が設定済みか） */
export function isLineLoginEnabled(): boolean {
  return CHANNEL_ID.length > 0;
}

export function lineCallbackUri(): string {
  return `${window.location.origin}/account/line-callback`;
}

/** authorize へ遷移してログイン開始。state を sessionStorage に保持して CSRF を防ぐ。 */
export function startLineLogin(redirect?: string | null): void {
  const state = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sessionStorage.setItem('line_state', state);
  if (redirect) sessionStorage.setItem('line_redirect', redirect);
  else sessionStorage.removeItem('line_redirect');

  const u = new URL(LINE_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CHANNEL_ID);
  u.searchParams.set('redirect_uri', lineCallbackUri());
  u.searchParams.set('state', state);
  // email は LINE の審査(メールアドレス取得権限)が必要。承認後に 'profile openid email' へ。
  u.searchParams.set('scope', 'profile openid');
  window.location.href = u.toString();
}

/** コールバックで code/state を受けて Custom Token を取得しサインインする。戻り値は redirect 先 URL。 */
export async function finishLineLogin(code: string, state: string): Promise<string | null> {
  const saved = sessionStorage.getItem('line_state');
  if (!saved || saved !== state) throw new Error('STATE_MISMATCH');
  const redirect = sessionStorage.getItem('line_redirect');
  sessionStorage.removeItem('line_state');
  sessionStorage.removeItem('line_redirect');

  const res = await fetch(`${FUNCTIONS_BASE}/lineLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: lineCallbackUri() }),
  });
  if (!res.ok) throw new Error(`LINE_LOGIN_FAILED_${res.status}`);
  const { customToken } = (await res.json()) as { customToken: string };
  await signInWithCustomToken(auth, customToken);
  if (auth.currentUser) await ensureAccountUser(auth.currentUser);
  return redirect;
}
