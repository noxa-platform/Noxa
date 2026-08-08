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
  sendEmailVerification,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  unlink,
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

/** 実行中のページの origin（SSR/テストでは null）。 */
function currentOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

export function isAllowedRedirect(
  redirectUrl: string | null | undefined,
  origin: string | null = currentOrigin(),
): boolean {
  if (!redirectUrl) return false;
  try {
    const u = new URL(redirectUrl);
    // スキームを http(s) に限定。ftp:/ws: 等の非 http スキームは、ホストが許可リストに
    // 一致しても custom token を載せた遷移を許さない（オープン redirect ハードニング）。
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // 自分自身（同一 origin）への復帰は常に許可。AuthGuard が作る戻り先は必ず自分の
    // origin なので、許可リストに載っていないホスト（カスタムドメイン・Vercel の
    // preview URL 等）で配信した瞬間に全ての深リンクが /account へ落ちるのを防ぐ。
    // 自分自身への遷移はオープン redirect にならない。
    if (origin && u.origin === origin) return true;
    return ALLOWED_REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * 未ログイン時に `/account/login?redirect=` へ渡す「戻り先 URL」を組み立てる。
 *
 * pathname だけで組むと招待リンク（`/store/join?shop=&code=`）のクエリが落ち、
 * ログイン後に「招待リンクが正しくありません」で行き止まりになる（＝新メンバーが
 * 参加できない）。クエリを保持する。
 * `noxaAuth`（SSO の custom token）は資格情報なので戻り先には持ち回らない。
 */
export function buildLoginRedirectUrl(loc: { origin: string; pathname: string; search?: string }): string {
  const params = new URLSearchParams(loc.search ?? '');
  params.delete('noxaAuth');
  const query = params.toString();
  return `${loc.origin}${loc.pathname}${query ? `?${query}` : ''}`;
}

export type PostLoginNavigation =
  /** 同一 origin へ戻る（custom token 交換は不要） */
  | { kind: 'same-origin'; path: string }
  /** 別アプリ（yorulog 等）へ custom token を載せて遷移する */
  | { kind: 'cross-origin'; url: string }
  /** redirect が無い・許可外 → Noxa Account のハブへ */
  | { kind: 'fallback' };

/**
 * ログイン後の遷移先を決める純関数。
 * 同一 origin を cross-origin と区別するのは、`noxaAuth`（custom token）を
 * 自分自身の URL に載せても消費者が居らず、①資格情報がアドレスバー/履歴に残る
 * ②交換 API が落ちると fallback で /account へ飛び、招待リンクの戻り先を失う——
 * という 2 つの実害があるため。
 */
export function planPostLoginNavigation(
  redirect: string | null | undefined,
  origin: string | null = currentOrigin(),
): PostLoginNavigation {
  if (!redirect || !isAllowedRedirect(redirect, origin)) return { kind: 'fallback' };
  const u = new URL(redirect);
  if (origin && u.origin === origin) {
    return { kind: 'same-origin', path: `${u.pathname}${u.search}${u.hash}` };
  }
  return { kind: 'cross-origin', url: redirect };
}

/** Email/Password サインアップ */
export async function signupWithEmail(email: string, password: string, displayName?: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureAccountUser(cred.user, displayName);
  // メール検証（Day11）: 送信失敗でもサインアップ自体は成立させる（バナーから再送可能）
  try { await sendEmailVerification(cred.user); } catch { /* 再送導線あり */ }
  return cred.user;
}

/** 検証メールの再送（未検証バナー用） */
export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

/**
 * メール検証バナーを出すべきか。
 * password プロバイダ（自己申告メール）かつ未検証のときのみ。
 * Google/Apple 等の IdP 経由は IdP 側で検証済みとして扱う。
 */
export function needsEmailVerification(user: User): boolean {
  if (user.emailVerified || !user.email) return false;
  return user.providerData.some((p) => p.providerId === 'password');
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

// ─────────────────────────────────────────────
// ログイン後の「アカウント連携設定」用
// ─────────────────────────────────────────────

export type ProviderId = 'google.com' | 'apple.com' | 'password';

/** 現在ログイン中ユーザーに紐付くプロバイダ ID 一覧 */
export function linkedProviderIds(user: User): string[] {
  return user.providerData.map((p) => p.providerId);
}

/** 現ユーザーに Google を追加連携 */
export async function linkGoogle(user: User): Promise<void> {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  await linkWithPopup(user, p);
}

/** 現ユーザーに Apple を追加連携 */
export async function linkApple(user: User): Promise<void> {
  await linkWithPopup(user, newAppleProvider());
}

/** 現ユーザーにメール/パスワードを追加（OAuth 専用アカウントにパスワードを設定） */
export async function linkEmailPassword(user: User, email: string, password: string): Promise<void> {
  await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  await ensureAccountUser(user);
}

/** プロバイダ連携を解除（最後の1つは解除させない） */
export async function unlinkProvider(user: User, providerId: string): Promise<void> {
  if (linkedProviderIds(user).length <= 1) {
    throw new Error('LAST_PROVIDER'); // 最低1つのログイン手段は残す
  }
  await unlink(user, providerId);
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
  const plan = planPostLoginNavigation(redirect);
  // 自分自身へ戻るだけなら custom token は不要（消費者が居ないうえ、交換失敗で
  // 戻り先を失う）。招待リンク → ログイン → 参加画面 の導線はここを通る。
  if (plan.kind === 'same-origin') {
    router.push(plan.path);
    return;
  }
  if (plan.kind === 'cross-origin') {
    try {
      const token = await fetchCustomToken();
      const url = new URL(plan.url);
      url.searchParams.set('noxaAuth', token);
      window.location.href = url.toString();
      return;
    } catch (e) {
      console.error('[noxa] custom token exchange failed, falling back to /account', e);
    }
  }
  router.push('/account');
}
