/**
 * 管理者判定ヘルパー。Web 側 `src/lib/admin.ts` の ADMIN_EMAILS と同期する。
 *
 * Cloud Functions の HTTP trigger で Firebase Auth ID トークンを検証してから、
 * decoded.email が管理者リストに含まれているかをチェックする。
 */
import { getAuth } from 'firebase-admin/auth';

const ADMIN_EMAILS: string[] = ['wpuhs2216@gmail.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

export interface AdminVerifyResult {
  uid: string;
  email: string;
}

/**
 * Authorization: Bearer <idToken> ヘッダーを検証し、管理者であれば uid/email を返す。
 * 認証失敗・管理者でない場合は例外を投げる（呼び出し側で 401/403 を返す）。
 */
export async function verifyAdmin(authHeader: string | undefined): Promise<AdminVerifyResult> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AdminAuthError(401, '認証トークンがありません');
  }
  const idToken = authHeader.slice(7);
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch {
    throw new AdminAuthError(401, '認証トークンが無効です');
  }
  const email = (decoded.email as string | undefined) ?? null;
  if (!isAdminEmail(email)) {
    throw new AdminAuthError(403, '管理者権限がありません');
  }
  return { uid: decoded.uid, email: email as string };
}

export class AdminAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AdminAuthError';
  }
}
