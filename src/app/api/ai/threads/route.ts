import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyRequest, AuthError } from '../../lib/firebase-admin';
import { resolveAccessContext } from '../../lib/access-context';

/**
 * AI チャットスレッド（複数会話セッション）の一覧取得 / 新規作成。
 *
 * Firestore 構造:
 *   shop_shops/{wid}/ai_threads/{threadId} {
 *     ownerUid: string,        // 所有者の uid（API 側で認可）
 *     title: string,           // ユーザー可視のタイトル（最初のメッセージ先頭 30 文字 or 手動）
 *     createdAt: number,
 *     updatedAt: number,
 *     messageCount: number,
 *     messages: [{ role, content, ts }]   // 直近 100 件、サイズ制限あり
 *   }
 *
 * 旧 ai_sessions/{uid} に履歴を持っていたユーザーは、初回 GET 時に「最初のトーク」として
 * ai_threads に自動マイグレーションする（旧 doc は rollback 用に残す）。
 */

const MIGRATION_TITLE = '以前のチャット';
const TITLE_MAX_LENGTH = 30;

type ThreadSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

function deriveTitleFromContent(content: string): string {
  // 改行を空白に潰し、先頭から TITLE_MAX_LENGTH 文字を切り出す
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= TITLE_MAX_LENGTH) return flat || '新しいトーク';
  return flat.slice(0, TITLE_MAX_LENGTH) + '…';
}

export async function GET(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const db = getAdminDb();
    const threadsRef = db.collection(`shop_shops/${workspaceId}/ai_threads`);

    // ownerUid + orderBy(updatedAt) の組合せは複合インデックスが必要なので、
    // 単純な where だけ走らせて JS 側でソートする（thread 数はユーザーあたり数百以下を想定）。
    const snap = await threadsRef.where('ownerUid', '==', uid).get();

    const threads: ThreadSummary[] = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || '新しいトーク',
          createdAt: data.createdAt || 0,
          updatedAt: data.updatedAt || 0,
          messageCount: data.messageCount || 0,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    // マイグレーション: threads が空かつ旧 ai_sessions にメッセージがあれば、最初のトークとして取り込む
    if (threads.length === 0) {
      const legacyRef = db.doc(`shop_shops/${workspaceId}/ai_sessions/${uid}`);
      const legacySnap = await legacyRef.get();
      const legacyMessages = legacySnap.exists ? (legacySnap.data()?.messages || []) : [];
      if (legacyMessages.length > 0) {
        const now = Date.now();
        const firstUserMsg = legacyMessages.find((m: { role: string; content: string }) => m.role === 'user');
        const title = firstUserMsg
          ? deriveTitleFromContent(firstUserMsg.content)
          : MIGRATION_TITLE;
        const newThread = await threadsRef.add({
          ownerUid: uid,
          title,
          createdAt: legacySnap.data()?.updatedAt || now,
          updatedAt: now,
          messageCount: legacyMessages.length,
          messages: legacyMessages,
        });
        threads.push({
          id: newThread.id,
          title,
          createdAt: legacySnap.data()?.updatedAt || now,
          updatedAt: now,
          messageCount: legacyMessages.length,
        });
      }
    }

    return NextResponse.json({ threads });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('threads GET error:', error);
    return NextResponse.json({ error: 'スレッド一覧の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const workspaceId: string | undefined = body.workspaceId;
    const titleInput: string | undefined = body.title;
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId は必須です' }, { status: 400 });
    }
    const ctx = await resolveAccessContext(uid, workspaceId);

    const now = Date.now();
    const title = (titleInput && titleInput.trim()) || '新しいトーク';

    const db = getAdminDb();
    const threadsRef = db.collection(`shop_shops/${workspaceId}/ai_threads`);
    const docRef = await threadsRef.add({
      ownerUid: uid,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      messages: [],
    });

    return NextResponse.json({
      thread: {
        id: docRef.id,
        title,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    console.error('threads POST error:', error);
    return NextResponse.json({ error: 'スレッドの作成に失敗しました' }, { status: 500 });
  }
}
