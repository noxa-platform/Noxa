'use client';

/**
 * Firestore 実装（CommunityRepository）。noxa-platform の noxa_* 名前空間を使う。
 *
 * コレクション（firestore.rules の予約ブロックに対応）:
 *   noxa_boards/{boardId}      … 板
 *   noxa_posts/{postId}        … スレッド（>>1 本文を内包、commentCount を非正規化）
 *   noxa_comments/{commentId}  … レス（postId で紐付け、1 段フラット）
 *   noxa_likes/{uid_kind_id}   … いいね（存在＝いいね済み）
 *   noxa_reports/{reportId}    … 通報
 *
 * 投稿者は完全匿名: UI には authorUid を出さず、anonId(uid, postId) で表示用 ID を導出する。
 * クエリは boardId + lastActivityAt のみで引き、ピン留め優先とタグ絞り込みはクライアント側で行う
 * （複合インデックスの増殖を避けるため）。
 */

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  increment, limit, orderBy, query, runTransaction, serverTimestamp,
  Timestamp, where,
  type DocumentData, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { anonId } from './anon-id';
import type { AreaTag, Board, JobTag, Reply, Thread, ThreadFilter } from './types';
import type {
  AddReplyInput, CommunityRepository, CreateThreadInput, LikeTarget, ReportTarget,
} from './repository';

const C = {
  boards: 'noxa_boards',
  posts: 'noxa_posts',
  comments: 'noxa_comments',
  likes: 'noxa_likes',
  reports: 'noxa_reports',
} as const;

/** Timestamp を相対表記に。null（serverTimestamp 反映前）は「たった今」 */
function relTime(ts: unknown): string {
  if (!(ts instanceof Timestamp)) return 'たった今';
  const diff = Date.now() - ts.toMillis();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  return day < 2 ? '昨日' : `${day}日前`;
}

function mapBoard(d: QueryDocumentSnapshot<DocumentData>): Board {
  const x = d.data();
  return {
    id: d.id,
    name: x.name ?? '',
    desc: x.desc ?? '',
    threadCount: x.threadCount ?? 0,
    postsToday: x.postsToday ?? 0,
    lastActivity: relTime(x.lastActivityAt),
    featured: x.featured ?? false,
    wedge: x.wedge ?? false,
  };
}

function mapThreadDoc(d: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData }): Thread {
  const x = d.data();
  return {
    id: d.id,
    boardId: x.boardId,
    title: x.title ?? '',
    anonId: anonId(x.authorUid ?? '', d.id),
    postedAt: relTime(x.createdAt),
    lastActivity: relTime(x.lastActivityAt ?? x.createdAt),
    body: x.body ?? '',
    replies: [],
    replyCount: x.commentCount ?? 0,
    areaTag: x.areaTag ?? undefined,
    jobTag: x.jobTag ?? undefined,
    pinned: x.pinned ?? false,
    likeCount: x.likeCount ?? 0,
  };
}

function mapComment(d: QueryDocumentSnapshot<DocumentData>, postId: string): Reply {
  const x = d.data();
  return {
    id: d.id,
    resNo: x.resNo ?? 2,
    anonId: anonId(x.authorUid ?? '', postId),
    postedAt: relTime(x.createdAt),
    body: x.body ?? '',
    likeCount: x.likeCount ?? 0,
    areaTag: x.areaTag ?? undefined,
    jobTag: x.jobTag ?? undefined,
  };
}

export class FirestoreCommunityRepository implements CommunityRepository {
  /** 書き込み主体の uid（認証必須ページからの利用を前提）。表には出さない。 */
  constructor(private readonly uid: string) {}

  async listBoards(): Promise<Board[]> {
    const snap = await getDocs(query(collection(db, C.boards), orderBy('order', 'asc')));
    return snap.docs.map(mapBoard);
  }

  async listThreads(boardId: string, filter?: ThreadFilter): Promise<Thread[]> {
    const snap = await getDocs(query(
      collection(db, C.posts),
      where('boardId', '==', boardId),
      orderBy('lastActivityAt', 'desc'),
      limit(100),
    ));
    let list = snap.docs.map((d) => mapThreadDoc(d));
    if (filter?.areaTag) list = list.filter((t) => t.areaTag === filter.areaTag);
    if (filter?.jobTag) list = list.filter((t) => t.jobTag === filter.jobTag);
    // ピン留め優先（安定ソート）
    return list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const postSnap = await getDoc(doc(db, C.posts, threadId));
    if (!postSnap.exists()) return null;
    const thread = mapThreadDoc({ id: postSnap.id, data: () => postSnap.data() as DocumentData });
    const cSnap = await getDocs(query(
      collection(db, C.comments),
      where('postId', '==', threadId),
      orderBy('resNo', 'asc'),
    ));
    thread.replies = cSnap.docs.map((d) => mapComment(d, threadId));
    thread.replyCount = thread.replies.length;
    return thread;
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const ref = await addDoc(collection(db, C.posts), {
      boardId: input.boardId,
      title: input.title,
      body: input.body,
      authorUid: this.uid,
      areaTag: input.areaTag ?? null,
      jobTag: input.jobTag ?? null,
      pinned: false,
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });
    const created = await this.getThread(ref.id);
    if (!created) throw new Error('createThread: 作成直後の取得に失敗');
    return created;
  }

  async addReply(threadId: string, input: AddReplyInput): Promise<Thread> {
    const postRef = doc(db, C.posts, threadId);
    const commentRef = doc(collection(db, C.comments));
    await runTransaction(db, async (tx) => {
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists()) throw new Error(`post not found: ${threadId}`);
      const resNo = (postSnap.data().commentCount ?? 0) + 2;
      tx.set(commentRef, {
        postId: threadId,
        resNo,
        authorUid: this.uid,
        body: input.body,
        areaTag: input.areaTag ?? null,
        jobTag: input.jobTag ?? null,
        likeCount: 0,
        createdAt: serverTimestamp(),
      });
      tx.update(postRef, { commentCount: increment(1), lastActivityAt: serverTimestamp() });
    });
    const updated = await this.getThread(threadId);
    if (!updated) throw new Error('addReply: 取得に失敗');
    return updated;
  }

  async toggleLike(target: LikeTarget): Promise<Thread> {
    const targetId = target.kind === 'thread' ? target.threadId : target.replyId;
    const targetRef = target.kind === 'thread'
      ? doc(db, C.posts, target.threadId)
      : doc(db, C.comments, target.replyId);
    const likeRef = doc(db, C.likes, `${this.uid}_${target.kind}_${targetId}`);
    await runTransaction(db, async (tx) => {
      const likeSnap = await tx.get(likeRef);
      if (likeSnap.exists()) {
        tx.delete(likeRef);
        tx.update(targetRef, { likeCount: increment(-1) });
      } else {
        tx.set(likeRef, {
          uid: this.uid,
          kind: target.kind,
          targetId,
          postId: target.threadId,
          createdAt: serverTimestamp(),
        });
        tx.update(targetRef, { likeCount: increment(1) });
      }
    });
    const updated = await this.getThread(target.threadId);
    if (!updated) throw new Error('toggleLike: 取得に失敗');
    return updated;
  }

  async report(target: ReportTarget): Promise<void> {
    const targetId = target.kind === 'thread' ? target.threadId : target.replyId;
    await addDoc(collection(db, C.reports), {
      targetType: target.kind,
      targetId,
      postId: target.threadId,
      reporterUid: this.uid,
      status: 'open',
      createdAt: serverTimestamp(),
    });
  }

  /** ユーザーが既にいいね済みの like キー集合を取得（初期表示用） */
  async listMyLikes(): Promise<string[]> {
    const snap = await getDocs(query(collection(db, C.likes), where('uid', '==', this.uid)));
    return snap.docs.map((d) => {
      const x = d.data();
      return x.kind === 'thread' ? `t:${x.targetId}` : `r:${x.postId}:${x.targetId}`;
    });
  }
}
