/**
 * コミュニティのデータアクセス抽象（repository インターフェース）。
 *
 * UI / フックはこのインターフェースだけに依存する。現状は MockCommunityRepository
 * （インメモリ）を注入し、将来 Firestore（noxa_* コレクション）実装に差し替える。
 * すべて非同期にしてあるので Firebase 版でもシグネチャは変わらない。
 */

import type { AreaTag, Board, JobTag, Reply, Thread, ThreadFilter } from './types';

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
  /** いいねトグル。liked は「押す前の状態」。更新後のスレッドを返す。 */
  toggleLike(target: LikeTarget, liked: boolean): Promise<Thread>;
  report(target: ReportTarget): Promise<void>;
}

// 便宜上の re-export（呼び出し側が型をまとめて import できるように）
export type { Board, Reply, Thread, ThreadFilter };
