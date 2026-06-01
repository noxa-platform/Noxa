import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../../lib/firebase-admin';
import { resolveAccessContext } from '../../../lib/access-context';

/**
 * AI チャットスレッドの個別操作（リネーム / 削除）。
 * 認可: ドキュメントの ownerUid が呼び出し元 uid と一致する場合のみ。
 */

const TITLE_MAX_LENGTH = 60;

async function loadThread(workspaceId: string, threadId: string, uid: string) {
  const db = getAdminDb();
  const ref = db.doc(`shop_shops/${workspaceId}/ai_threads/${threadId}`);
  const snap = await ref.get();
  if (!snap.exists) return { ref, snap, error: 'notFound' as const };
  const data = snap.data();
  if (!data || data.ownerUid !== uid) {
    return { ref, snap, error: 'forbidden' as const };
  }
  return { ref, snap, data };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  try {
    const uid = await verifyRequest(request);
    const { threadId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const workspaceId: string | undefined = body.workspaceId;
    const titleInput: string | undefined = body.title;
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    if (typeof titleInput !== 'string' || titleInput.trim() === '') {
      return NextResponse.json({ error: 'title は必須です' }, { status: 400 });
    }
    const title = titleInput.trim().slice(0, TITLE_MAX_LENGTH);
    const ctx = await resolveAccessContext(uid, workspaceId);

    const loaded = await loadThread(workspaceId, threadId, uid);
    if (loaded.error === 'notFound') {
      return NextResponse.json({ error: '対象のスレッドが見つかりません' }, { status: 404 });
    }
    if (loaded.error === 'forbidden') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    await loaded.ref.update({ title, updatedAt: Date.now() });
    return NextResponse.json({ ok: true, title });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('thread PATCH error:', error);
    return NextResponse.json({ error: 'スレッドの更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  try {
    const uid = await verifyRequest(request);
    const { threadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const loaded = await loadThread(workspaceId, threadId, uid);
    if (loaded.error === 'notFound') {
      // 既に消えている = 成功扱い（idempotent）
      return NextResponse.json({ ok: true });
    }
    if (loaded.error === 'forbidden') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    await loaded.ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('thread DELETE error:', error);
    return NextResponse.json({ error: 'スレッドの削除に失敗しました' }, { status: 500 });
  }
}
