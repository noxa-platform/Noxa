/**
 * コミュニティのデータアクセス抽象（repository インターフェース）。
 *
 * UI / フックはこのインターフェースだけに依存する。現状は MockCommunityRepository
 * （インメモリ）を注入し、将来 Firestore（noxa_* コレクション）実装に差し替える。
 * すべて非同期にしてあるので Firebase 版でもシグネチャは変わらない。
 */

import type { AreaTag, Board, JobTag, Reply, Thread, ThreadFilter } from './types';

/**
 * コミュニティのバックエンド判定（Day10 本番化）。
 * 既定は Firestore（本番）。ローカルで実データに触りたくない場合のみ
 * NEXT_PUBLIC_COMMUNITY_BACKEND=mock で明示的にモックへ切り替える。
 * 判定はここ1箇所に集約し、Gate / Client / store の条件食い違いを防ぐ。
 */
export function isFirestoreCommunityBackend(): boolean {
  return process.env.NEXT_PUBLIC_COMMUNITY_BACKEND !== 'mock';
}

export interface CreateThreadInput {
  boardId: string;
  title: string;
  body: string;
  areaTag?: AreaTag;
  jobTag?: JobTag;
}

export interface AddReplyInput {
  body: string;
  areaTag?: AreaTag;
  jobTag?: JobTag;
}

export interface EditThreadInput {
  title?: string;
  body: string;
}

export interface EditReplyInput {
  body: string;
}

export type LikeTarget =
  | { kind: 'thread'; threadId: string }
  | { kind: 'reply'; threadId: string; replyId: string };

export type ReportTarget = LikeTarget;

export interface CommunityRepository {
  listBoards(): Promise<Board[]>;
  listThreads(boardId: string, filter?: ThreadFilter): Promise<Thread[]>;
  getThread(threadId: string): Promise<Thread | null>;
  createThread(input: CreateThreadInput): Promise<Thread>;
  /** レス追加。更新後のスレッドを返す。 */
  addReply(threadId: string, input: AddReplyInput): Promise<Thread>;
  /** スレッド(>>1)の本文編集。本人のみ。更新後のスレッドを返す。 */
  editThread(threadId: string, input: EditThreadInput): Promise<Thread>;
  /** レスの本文編集。本人のみ。更新後のスレッドを返す。 */
  editReply(threadId: string, replyId: string, input: EditReplyInput): Promise<Thread>;
  /** スレッド削除。本人のみ。 */
  deleteThread(threadId: string): Promise<void>;
  /** レス削除。本人のみ。更新後のスレッドを返す。 */
  deleteReply(threadId: string, replyId: string): Promise<Thread>;
  /** いいねトグル。liked は「押す前の状態」。更新後のスレッドを返す。 */
  toggleLike(target: LikeTarget, liked: boolean): Promise<Thread>;
  report(target: ReportTarget): Promise<void>;
}

// 便宜上の re-export（呼び出し側が型をまとめて import できるように）
export type { Board, Reply, Thread, ThreadFilter };
