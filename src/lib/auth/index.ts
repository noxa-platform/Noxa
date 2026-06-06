/**
 * Noxa 認証フロー
 *
 * - Firebase Auth を直接使う（noxa は same Firebase project を共有）
 * - クロスドメイン redirect: redirect=https://yorulog.vercel.app/home 等の URL を query で受けて、
 *   ログイン成功後に Custom Token を発行 → redirect 先に token を渡す
 * - allowedRedirectHosts に登録された host のみ redirect 許可（オープン redirect 防止）
 */
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
  OAuthProvider,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase/config';

export const ALLOWED_REDIRECT_HOSTS = [
  'yorulog.vercel.app',
  'nomishugy.vercel.app',
  'noxa-delta.vercel.app',
  'localhost',
  // 本番ドメイン取得後に追加
  // 'yorulog.noxa.app',
  // 'nomishugy.noxa.app',
];

export function isAllowedRedirect(redirectUrl: string | null | undefined): boolean {
  if (!redirectUrl) return false;
  try {
    const u = new URL(redirectUrl);
    return ALLOWED_REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Email/Password サインアップ */
export async function signupWithEmail(email: string, password: string, displayName?: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureAccountUser(cred.user, displayName);
  return cred.user;
}

/** Email/Password ログイン */
export async function loginWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureAccountUser(cred.user);
  return cred.user;
}

/** Google サインイン（ポップアップ） */
export async function signinWithGoogle(): Promise<User> {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureAccountUser(cred.user);
  return cred.user;
}

/**
 * Apple サインイン（ポップアップ）
 * Firebase Console で Apple provider 有効化 + Service ID 設定済み前提:
 *   - Service ID: app.noxa.signin
 *   - Apple Developer の Web Auth Domain に noxa-platform.firebaseapp.com 登録済み
 *   - Return URL: https://noxa-platform.firebaseapp.com/__/auth/handler
 */
export async function signinWithApple(): Promise<User> {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  const cred = await signInWithPopup(auth, provider);
  await ensureAccountUser(cred.user);
  return cred.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}

/**
 * account_users/{uid} を必ず存在させる。
 * 既存ユーザーは createdAt 等を保持。新規は基本フィールド + platformRole='user'。
 */
export async function ensureAccountUser(user: User, displayName?: string): Promise<void> {
  const ref = doc(db, `account_users/${user.uid}`);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    // 既存: 最終ログイン時刻だけ更新
    await setDoc(ref, { updatedAt: serverTimestamp(), lastLoginAt: serverTimestamp() }, { merge: true });
    return;
  }
  // 新規
  await setDoc(ref, {
    id: user.uid,
    email: user.email ?? null,
    displayName: displayName ?? user.displayName ?? null,
    avatar: user.photoURL ?? null,
    platformRole: 'user',
    status: 'active',
    onboardingCompleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });
}

/**
 * Custom Token 発行 API を呼び出す。
 * Noxa でログイン済みのユーザーが yorulog/nomishugy に遷移するとき使う。
 *
 * Cloud Function `exchangeAuthToken` が:
 *   1. Authorization: Bearer <noxa の ID Token> を検証
 *   2. 同じ uid の Custom Token を生成して返す
 * クライアントは取得した Custom Token を redirect URL の query に付けて返す。
 */
export async function fetchCustomToken(): Promise<string> {
  if (!auth.currentUser) throw new Error('NOT_AUTHENTICATED');
  const idToken = await auth.currentUser.getIdToken();
  const apiBase = process.env.NEXT_PUBLIC_NOXA_FUNCTIONS_URL
    ?? 'https://asia-northeast1-noxa-platform.cloudfunctions.net';
  const res = await fetch(`${apiBase}/exchangeAuthToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = await res.json() as { customToken: string };
  return json.customToken;
}

/**
 * ログイン成功後に呼び出す。redirect query があれば custom token 付きで遷移。
 * 無ければ Noxa Account のハブ (/account) に飛ばす。
 */
export async function handlePostLoginRedirect(redirect: string | null, router: { push: (url: string) => void }): Promise<void> {
  if (redirect && isAllowedRedirect(redirect)) {
    try {
      const token = await fetchCustomToken();
      const url = new URL(redirect);
      url.searchParams.set('noxaAuth', token);
      window.location.href = url.toString();
      return;
    } catch (e) {
      console.error('[noxa] custom token exchange failed, falling back to /account', e);
    }
  }
  router.push('/account');
}
