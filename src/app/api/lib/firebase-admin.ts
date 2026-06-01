// Firebase Admin SDK（サーバーサイド専用）
// セキュリティルールをバイパスしてFirestoreに直接アクセス
import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

let _app: App | null = null;

function getAdminApp(): App {
  if (_app) return _app;
  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY が設定されていません');
  }

  // .env.local からの読込時に dotenv が `\n` を実改行に展開すると、
  // JSON.parse が「Bad control character in string literal」で落ちる。
  // Vercel 本番では起きにくいが、ローカル dev で頻発するため対処。
  // 戦略:
  //   1. 末尾の `}` 以降のゴミ（trailing \n 等）を切る
  //   2. 文字列リテラル内の実改行（LF/CR）を `\n` エスケープに復元してから parse
  let cleanedKey = serviceAccountKey.trim();
  const lastBrace = cleanedKey.lastIndexOf('}');
  if (lastBrace > -1 && lastBrace < cleanedKey.length - 1) {
    cleanedKey = cleanedKey.slice(0, lastBrace + 1);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanedKey);
  } catch {
    // 2nd attempt: 実改行を再エスケープ
    try {
      parsed = JSON.parse(
        cleanedKey.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t'),
      );
    } catch (err2) {
      console.error('FIREBASE_SERVICE_ACCOUNT_KEY JSON parse failed:', err2);
      throw err2;
    }
  }

  _app = initializeApp({
    credential: cert(parsed as Parameters<typeof cert>[0]),
  });
  return _app;
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

// 認証エラー用カスタムクラス
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// リクエストからFirebase IDトークンを検証してuidを返す
export async function verifyRequest(request: Request): Promise<string> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('認証トークンがありません');
  }
  const idToken = authHeader.slice(7);
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    throw new AuthError('認証トークンが無効です');
  }
}

/**
 * ワークスペースアクセス権限を検証する。
 *
 * Firebase Admin SDK は Firestore rules をバイパスするため、API ルートで
 * workspaceId を受け取る際は必ず uid がそのワークスペースのメンバーである
 * ことを確認する必要がある（さもないと他人のワークスペースを覗ける）。
 *
 * 検証順:
 *   1. ワークスペースの ownerUid と uid が一致するか
 *   2. shop_shops/{wid}/members/{uid} が存在するか
 *
 * @throws AuthError - workspaceId 不正・存在しない・アクセス権なしのとき
 */
export async function verifyWorkspaceAccess(
  uid: string,
  workspaceId: string,
): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new AuthError('ワークスペースIDが不正です');
  }

  const db = getAdminDb();
  const wsRef = db.doc(`shop_shops/${workspaceId}`);
  const wsSnap = await wsRef.get();

  if (!wsSnap.exists) {
    throw new AuthError('ワークスペースが見つかりません');
  }

  const data = wsSnap.data() as { ownerUid?: string } | undefined;
  if (data?.ownerUid === uid) return; // オーナーは常にアクセス可

  const memberSnap = await db
    .doc(`shop_shops/${workspaceId}/members/${uid}`)
    .get();

  if (!memberSnap.exists) {
    throw new AuthError('このワークスペースへのアクセス権限がありません');
  }
}

/**
 * verifyRequest + verifyWorkspaceAccess を一度に行う便利関数。
 * 戻り値: 認証された uid
 */
export async function verifyRequestWithWorkspace(
  request: Request,
  workspaceId: string,
): Promise<string> {
  const uid = await verifyRequest(request);
  await verifyWorkspaceAccess(uid, workspaceId);
  return uid;
}
