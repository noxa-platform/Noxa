'use client';

/**
 * アカウント統合（クライアント）。
 * 「残すアカウント A」でログイン中のまま、統合元 B を別 Firebase アプリ（セカンダリ）で
 * 認証して B の ID Token を取得し、mergeAccounts 関数に渡す（A のセッションは保持）。
 * LINE は redirect フローのため line-callback から finishLineMerge を呼ぶ。
 */
import { initializeApp, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, signInWithCustomToken, signOut, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { firebaseConfig, auth } from '@/lib/firebase/config';
import { startLineLogin } from '@/lib/auth/line';

const FUNCTIONS_BASE = process.env.NEXT_PUBLIC_NOXA_FUNCTIONS_URL ?? 'https://asia-northeast1-noxa-platform.cloudfunctions.net';

export type MergeResult = { ok: boolean; summary?: Record<string, unknown>; errors?: string[] };

function secondaryAuth() {
  let app;
  try { app = getApp('merge-src'); } catch { app = initializeApp(firebaseConfig, 'merge-src'); }
  return getAuth(app);
}

async function callMerge(sourceIdToken: string): Promise<MergeResult> {
  if (!auth.currentUser) throw new Error('NOT_AUTHENTICATED');
  const aToken = await auth.currentUser.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/mergeAccounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aToken}` },
    body: JSON.stringify({ sourceIdToken }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; summary?: Record<string, unknown>; errors?: string[] };
  if (!res.ok) throw new Error(json.error || `MERGE_FAILED_${res.status}`);
  return { ok: true, summary: json.summary, errors: json.errors };
}

async function sourceTokenViaPopup(provider: GoogleAuthProvider | OAuthProvider): Promise<string> {
  const sa = secondaryAuth();
  try {
    const res = await signInWithPopup(sa, provider);
    if (res.user.uid === auth.currentUser?.uid) throw new Error('SAME_ACCOUNT');
    return await res.user.getIdToken();
  } finally { try { await signOut(sa); } catch { /* ignore */ } }
}

export async function mergeWithGoogle(): Promise<MergeResult> {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return callMerge(await sourceTokenViaPopup(p));
}

export async function mergeWithApple(): Promise<MergeResult> {
  const p = new OAuthProvider('apple.com');
  p.addScope('email');
  return callMerge(await sourceTokenViaPopup(p));
}

// ── LINE（redirect） ──
export function startLineMerge(): void {
  sessionStorage.setItem('line_merge', '1');
  startLineLogin(); // redirect なしで authorize へ
}

export function isLineMergePending(): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem('line_merge') === '1';
}

export async function finishLineMerge(code: string, state: string): Promise<MergeResult> {
  const saved = sessionStorage.getItem('line_state');
  if (!saved || saved !== state) throw new Error('STATE_MISMATCH');
  sessionStorage.removeItem('line_state');
  sessionStorage.removeItem('line_merge');
  sessionStorage.removeItem('line_redirect');

  const res = await fetch(`${FUNCTIONS_BASE}/lineLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: `${window.location.origin}/account/line-callback` }),
  });
  if (!res.ok) throw new Error(`LINE_FAILED_${res.status}`);
  const { customToken } = (await res.json()) as { customToken: string };

  const sa = secondaryAuth();
  try {
    const cred = await signInWithCustomToken(sa, customToken);
    if (cred.user.uid === auth.currentUser?.uid) throw new Error('SAME_ACCOUNT');
    const bToken = await cred.user.getIdToken();
    return await callMerge(bToken);
  } finally { try { await signOut(sa); } catch { /* ignore */ } }
}
