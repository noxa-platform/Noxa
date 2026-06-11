import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

// Noxa は yorulog / nomishugy と同じ Firebase プロジェクト (noxa-platform) を共有。
// すべてのプロダクトが同一 Firebase Auth + Firestore を使うため、
// account_users / account_subscriptions / account_credit_ledger 等の共通ドメインが直接読める。
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const isServerBuildWithoutEnv = typeof window === 'undefined' && !firebaseConfig.apiKey;

const app: FirebaseApp | null = isServerBuildWithoutEnv
  ? null
  : getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

// オフライン永続化（IndexedDB キャッシュ＋複数タブ対応）。回線断でも会計/伝票はローカルに
// 貯まり、復帰時に自動同期。ブラウザのみ。emulator/HMR/既初期化時は getFirestore にフォールバック。
function initDb(a: FirebaseApp): Firestore {
  if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_USE_EMULATOR === 'true') return getFirestore(a);
  try {
    return initializeFirestore(a, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    return getFirestore(a); // 既に initializeFirestore/getFirestore 済み（HMR 等）
  }
}
export const db = (app ? initDb(app) : null) as unknown as Firestore;
export const auth = (app ? getAuth(app) : null) as unknown as Auth;
export const googleProvider = new GoogleAuthProvider();

declare global {
  // eslint-disable-next-line no-var
  var __NOXA_EMULATOR_CONNECTED__: boolean | undefined;
}
if (
  typeof window !== 'undefined'
  && process.env.NEXT_PUBLIC_USE_EMULATOR === 'true'
  && !globalThis.__NOXA_EMULATOR_CONNECTED__
  && app
) {
  try {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    globalThis.__NOXA_EMULATOR_CONNECTED__ = true;
    console.log('[noxa] connected to local emulators');
  } catch (e) {
    console.warn('[noxa] emulator connect failed', e);
  }
}

export default app;
