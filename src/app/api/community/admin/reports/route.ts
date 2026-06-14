// 通報一覧（admin 専用）。対象ごとにまとめ、対象本文プレビュー・通報者数・非表示状態を返す。
//
// POST { status?: 'open'|'all' } -> { items: [{ targetType, targetId, postId, preview, reportCount, hidden, reporters, reportIds }] }

import { NextRequest, NextResponse } from 'next/server';
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
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const onlyOpen = body?.status !== 'all';
    const db = getAdminDb();

    const snap = await db.collection('noxa_reports').orderBy('createdAt', 'desc').limit(200).get();

    // 対象ごとに集約
    const byTarget = new Map<string, { targetType: string; targetId: string; postId: string; reporters: Set<string>; reportIds: string[]; open: boolean }>();
    for (const d of snap.docs) {
      const r = d.data() as { targetType?: string; targetId?: string; postId?: string; reporterUid?: string; status?: string };
      if (!r.targetId || !r.targetType) continue;
      if (onlyOpen && r.status && r.status !== 'open') continue;
      const key = `${r.targetType}:${r.targetId}`;
      const cur = byTarget.get(key) ?? { targetType: r.targetType, targetId: r.targetId, postId: r.postId ?? r.targetId, reporters: new Set<string>(), reportIds: [], open: false };
      if (r.reporterUid) cur.reporters.add(r.reporterUid);
      cur.reportIds.push(d.id);
      if (!r.status || r.status === 'open') cur.open = true;
      byTarget.set(key, cur);
    }

    // 対象本文プレビュー・非表示状態を付与
    const items = await Promise.all([...byTarget.values()].map(async (t) => {
      const ref = db.doc(t.targetType === 'thread' ? `noxa_posts/${t.targetId}` : `noxa_comments/${t.targetId}`);
      const tSnap = await ref.get().catch(() => null);
      const td = tSnap?.exists ? (tSnap.data() as { body?: string; title?: string; hidden?: boolean; reportCount?: number }) : null;
      const preview = td ? `${td.title ? `【${td.title}】` : ''}${(td.body ?? '').slice(0, 80)}` : '(削除済み)';
      return {
        targetType: t.targetType,
        targetId: t.targetId,
        postId: t.postId,
        preview,
        exists: !!td,
        hidden: td?.hidden === true,
        reportCount: td?.reportCount ?? t.reporters.size,
        reporters: t.reporters.size,
        reportIds: t.reportIds,
        open: t.open,
      };
    }));

    items.sort((a, b) => b.reporters - a.reporters);
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.message.includes('トークン') ? 401 : 403 });
    }
    console.error('[api/community/admin/reports] error:', e);
    return NextResponse.json({ error: '通報一覧の取得に失敗しました' }, { status: 500 });
  }
}
