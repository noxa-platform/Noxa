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
      // 取得失敗を「削除済み」と同一視しない（Day116）。
      // 旧実装は読めなかった対象も `(削除済み)` / `exists:false` として返しており、
      // 運営は**もう消えている**と判断して通報を閉じてしまう（実際は投稿が残っている）。
      let fetchFailed = false;
      const tSnap = await ref.get().catch((e) => {
        console.error('[api/community/admin/reports] target fetch failed:', t.targetId, e);
        fetchFailed = true;
        return null;
      });
      const td = tSnap?.exists ? (tSnap.data() as { body?: string; title?: string; hidden?: boolean; reportCount?: number }) : null;
      const preview = td
        ? `${td.title ? `【${td.title}】` : ''}${(td.body ?? '').slice(0, 80)}`
        : (fetchFailed ? '(本文を取得できませんでした)' : '(削除済み)');
      return {
        targetType: t.targetType,
        targetId: t.targetId,
        postId: t.postId,
        preview,
        exists: !!td,
        /** 対象の取得自体に失敗したか（true のとき exists:false は「削除済み」を意味しない） */
        fetchFailed,
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
