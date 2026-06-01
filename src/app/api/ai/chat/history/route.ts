import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../../lib/firebase-admin';
import { resolveAccessContext } from '../../../lib/access-context';

/**
 * AI チャットの履歴取得 / クリア。threadId 必須。
 *
 * 旧 ai_sessions/{uid} のフォールバックは廃止済み（マイグレーションは
 * /api/ai/threads GET 内で行うため、こちらは ai_threads のみ参照）。
 */

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const threadId = searchParams.get('threadId');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    if (!threadId) {
      return NextResponse.json({ error: 'threadId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const db = getAdminDb();
    const ref = db.doc(`shop_shops/${workspaceId}/ai_threads/${threadId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ messages: [] });
    }
    const data = snap.data() || {};
    if (data.ownerUid !== uid) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    return NextResponse.json({
      messages: data.messages || [],
      updatedAt: data.updatedAt || null,
      title: data.title || null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('chat history GET error:', error);
    return NextResponse.json({ error: '履歴の取得に失敗しました' }, { status: 500 });
  }
}

// チャット履歴をクリア（指定スレッドの messages のみ空に。スレッド doc 自体は残す）
export async function DELETE(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const threadId = searchParams.get('threadId');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    if (!threadId) {
      return NextResponse.json({ error: 'threadId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const db = getAdminDb();
    const ref = db.doc(`shop_shops/${workspaceId}/ai_threads/${threadId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: true });
    }
    if (snap.data()?.ownerUid !== uid) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    await ref.update({
      messages: [],
      messageCount: 0,
      updatedAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('chat history DELETE error:', error);
    return NextResponse.json({ error: '履歴の削除に失敗しました' }, { status: 500 });
  }
}
