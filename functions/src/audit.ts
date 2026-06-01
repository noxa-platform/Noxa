// 監査ログ writer (Cloud Functions 側)。Next.js 側の src/app/api/lib/audit.ts と同型。
//
// Functions 内の重要操作（アカウント削除 / shop claim 承認 等）で使用。
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { db } from './admin';

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

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const firestore = db();
    const ref = firestore.collection('audit_logs').doc();
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
    logger.error('[writeAuditLog] failed', entry.action, error);
  }
}
