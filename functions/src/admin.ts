/**
 * Firebase Admin SDK の単一インスタンスを export する。
 * 各 scheduled function から参照する。
 */
import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

let app: App | undefined;

function ensureApp(): App {
  if (app) return app;
  const apps = getApps();
  if (apps.length > 0) {
    app = apps[0];
    return app;
  }
  app = initializeApp();
  return app;
}

/**
 * 初期化済みの Admin App を返す。
 * getAuth(getAdminApp()) のように、Admin SDK サービスを使う前に呼ぶことで
 * 「app/no-app: The default Firebase app does not exist」を防ぐ。
 */
export function getAdminApp(): App {
  return ensureApp();
}

export function db(): Firestore {
  return getFirestore(ensureApp());
}

export function messaging(): Messaging {
  return getMessaging(ensureApp());
}
