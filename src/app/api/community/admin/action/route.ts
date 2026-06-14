// 通報モデレーション操作（admin 専用）。
//   action: 'hide' | 'unhide'          対象を非表示/復帰（+ 関連通報を resolved 化）
//           'resolve'                   通報だけ解決済みに（対象はそのまま）
//           'revokeInvite' | 'restoreInvite'  会員の招待発行権を停止/復帰
//
// POST { action, targetType?, targetId?, reportIds?, uid? } -> { ok: true }

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyRequest, getAdminDb, AuthError } from '../../../lib/firebase-admin';

async function requireAdmin(request: NextRequest): Promise<string> {
  const uid = await verifyRequest(request);
  const db = getAdminDb();
  const acc = await db.doc(`account_users/${uid}`).get();
  if ((acc.data() as { platformRole?: string } | undefined)?.platformRole !== 'admin') {
    throw new AuthError('管理者権限が必要です');
  }
  return uid;
}

export async function POST(request: NextRequest) {
  try {
    const adminUid = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const action: string | undefined = body?.action;
    const db = getAdminDb();

    const resolveReports = async (reportIds?: unknown) => {
      if (!Array.isArray(reportIds) || reportIds.length === 0) return;
      const batch = db.batch();
      for (const id of reportIds.slice(0, 400)) {
        if (typeof id !== 'string') continue;
        batch.set(db.doc(`noxa_reports/${id}`), { status: 'resolved', resolvedBy: adminUid, resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      await batch.commit();
    };

    if (action === 'hide' || action === 'unhide') {
      const { targetType, targetId } = body as { targetType?: string; targetId?: string };
      if ((targetType !== 'thread' && targetType !== 'reply') || !targetId) {
        return NextResponse.json({ error: 'targetType / targetId が不正です' }, { status: 400 });
      }
      const ref = db.doc(targetType === 'thread' ? `noxa_posts/${targetId}` : `noxa_comments/${targetId}`);
      await ref.set({ hidden: action === 'hide', moderatedBy: adminUid, moderatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await resolveReports(body?.reportIds);
      return NextResponse.json({ ok: true });
    }

    if (action === 'resolve') {
      await resolveReports(body?.reportIds);
      return NextResponse.json({ ok: true });
    }

    if (action === 'revokeInvite' || action === 'restoreInvite') {
      const uid: string | undefined = body?.uid;
      if (!uid || typeof uid !== 'string') return NextResponse.json({ error: 'uid が必要です' }, { status: 400 });
      const userRef = db.doc(`noxa_users/${uid}`);
      if (!(await userRef.get()).exists) return NextResponse.json({ error: '対象の会員が見つかりません' }, { status: 404 });
      await userRef.set({ invitePrivilegeRevoked: action === 'revokeInvite', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: '不明な action です' }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.message.includes('トークン') ? 401 : 403 });
    }
    console.error('[api/community/admin/action] error:', e);
    return NextResponse.json({ error: '操作に失敗しました' }, { status: 500 });
  }
}
