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
  linkWithCredential,
  fetchSignInMethodsForEmail,
  type AuthCredential,
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

/**
 * 既存メールが別プロバイダで登録済みのとき、パスワード入力でリンクが必要なことを示す。
 * UI 側でこれを catch してパスワードを尋ね、completeLinkWithPassword を呼ぶ。
 */
export class LinkPasswordRequiredError extends Error {
  email: string;
  pendingCred: AuthCredential;
  constructor(email: string, pendingCred: AuthCredential) {
    super('LINK_PASSWORD_REQUIRED');
    this.name = 'LinkPasswordRequiredError';
    this.email = email;
    this.pendingCred = pendingCred;
  }
}

function newAppleProvider(): OAuthProvider {
  const p = new OAuthProvider('apple.com');
  p.addScope('email');
  p.addScope('name');
  return p;
}

/**
 * OAuth ポップアップでサインイン。同一メールが別プロバイダで存在し
 * account-exists-with-different-credential になった場合は自動でアカウント統合する:
 *   - 既存が Google/Apple → 既存プロバイダで再サインイン → linkWithCredential で結合
 *   - 既存が password → LinkPasswordRequiredError を投げ、UI でパスワードを尋ねる
 */
async function popupOrLink(
  provider: GoogleAuthProvider | OAuthProvider,
  credentialFromError: (e: unknown) => AuthCredential | null,
): Promise<User> {
  try {
    const cred = await signInWithPopup(auth, provider);
    await ensureAccountUser(cred.user);
    return cred.user;
  } catch (e: unknown) {
    if ((e as { code?: string })?.code !== 'auth/account-exists-with-different-credential') throw e;
    const pendingCred = credentialFromError(e);
    const email = (e as { customData?: { email?: string } })?.customData?.email;
    if (!pendingCred || !email) throw e;

    const methods = await fetchSignInMethodsForEmail(auth, email);
    if (methods.includes('google.com')) {
      const gp = new GoogleAuthProvider();
      gp.setCustomParameters({ login_hint: email });
      const res = await signInWithPopup(auth, gp);
      await linkWithCredential(res.user, pendingCred);
      await ensureAccountUser(res.user);
      return res.user;
    }
    if (methods.includes('apple.com')) {
      const res = await signInWithPopup(auth, newAppleProvider());
      await linkWithCredential(res.user, pendingCred);
      await ensureAccountUser(res.user);
      return res.user;
    }
    if (methods.includes('password')) {
      throw new LinkPasswordRequiredError(email, pendingCred);
    }
    throw e;
  }
}

/** Google サインイン（同一メール自動リンク対応） */
export async function signinWithGoogle(): Promise<User> {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  return popupOrLink(googleProvider, (e) => GoogleAuthProvider.credentialFromError(e as never));
}

/**
 * Apple サインイン（同一メール自動リンク対応）
 * Firebase Console で Apple provider 有効化 + Service ID 設定済み前提:
 *   - Service ID: app.noxa.signin
 *   - Apple Developer の Web Auth Domain に noxa-platform.firebaseapp.com 登録済み
 *   - Return URL: https://noxa-platform.firebaseapp.com/__/auth/handler
 */
export async function signinWithApple(): Promise<User> {
  return popupOrLink(newAppleProvider(), (e) => OAuthProvider.credentialFromError(e as never));
}

/** パスワードで既存アカウントにログインし、保留中の OAuth 資格情報をリンクする。 */
export async function completeLinkWithPassword(email: string, password: string, pendingCred: AuthCredential): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, password);
  await linkWithCredential(res.user, pendingCred);
  await ensureAccountUser(res.user);
  return res.user;
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
