// 監査ログ writer。重要操作（admin 変更 / アカウント削除 / 権限付与等）を audit_logs に追記する。
//
// 設計:
//   - actor: 操作者（uid / email / role）
//   - action: 操作種別（例: 'user.delete', 'subscription.change', 'shop.claim_approve'）
//   - target: 操作対象（type / id）
//   - before / after: 変更前後のスナップショット（差分追跡用、optional）
//   - metadata: 任意の補足（IP / 理由 / 関連 ID 等）
//
// fire-and-forget で書く（失敗してもメイン処理は壊さない）。
import { getAdminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface AuditEntry {
  actor: {
    uid: string;
    email?: string | null;
    role?: 'admin' | 'user' | 'system';
  };
  action: string;
  target: {
    type: string;
    id: string;
    path?: string;
  };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * audit_logs/{auto_id} に 1 件追記する。
 * 引数は厳密 typing、内部で serverTimestamp / null 整形。
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = getAdminDb();
    const ref = db.collection('audit_logs').doc();
    await ref.set({
      actor: {
        uid: entry.actor.uid,
        email: entry.actor.email ?? null,
        role: entry.actor.role ?? 'user',
      },
      action: entry.action,
      target: {
        type: entry.target.type,
        id: entry.target.id,
        path: entry.target.path ?? null,
      },
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('writeAuditLog failed:', entry.action, error);
  }
}

/**
 * Next.js Request から IP / User-Agent を抽出するヘルパー。
 */
export function extractRequestMeta(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  };
}
