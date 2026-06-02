'use client';

/**
 * コミュニティの状態管理フック。
 *
 * UI は repository インターフェースに直接触らず、本フックの返す state / actions だけを使う。
 * 既定では MockCommunityRepository を注入する。Firestore 実装に差し替える場合は
 * createCommunityRepository を変えるだけで UI は無改修。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AreaTag, Board, JobTag, Thread, ThreadFilter } from './types';
import type { CommunityRepository } from './repository';
import { MockCommunityRepository } from './mock-repository';
import { FirestoreCommunityRepository } from './firestore-repository';

export type CommunityView = 'boards' | 'threads' | 'thread';

/**
 * repository ファクトリ（差し替えポイント）。
 * NEXT_PUBLIC_COMMUNITY_BACKEND=firestore かつ uid があれば Firestore、無ければ Mock。
 * 既定（未設定）は Mock なので、Firebase 未設定でもローカル閲覧が壊れない。
 */
export function createCommunityRepository(uid?: string): CommunityRepository {
  const backend = process.env.NEXT_PUBLIC_COMMUNITY_BACKEND;
  if (backend === 'firestore' && uid) {
    return new FirestoreCommunityRepository(uid);
  }
  return new MockCommunityRepository();
}

/** repo が初期いいね一覧を返せるか（Firestore 実装のみ） */
function hasListMyLikes(r: CommunityRepository): r is CommunityRepository & { listMyLikes: () => Promise<string[]> } {
  return typeof (r as { listMyLikes?: unknown }).listMyLikes === 'function';
}

export interface UseCommunity {
  view: CommunityView;
  boards: Board[];
  board: Board | null;
  threads: Thread[];        // 現在の板の（絞り込み後）スレッド一覧
  thread: Thread | null;    // 詳細表示中のスレッド
  areaFilter: AreaTag | null;
  jobFilter: JobTag | null;
  likedIds: Set<string>;
  loading: boolean;
  // navigation
  openBoard: (id: string) => void;
  openThread: (id: string) => void;
  backToBoards: () => void;
  backToThreads: () => void;
  // filters
  setAreaFilter: (v: AreaTag | null) => void;
  setJobFilter: (v: JobTag | null) => void;
  // mutations
  createThread: (input: { title: string; body: string; areaTag?: AreaTag; jobTag?: JobTag }) => Promise<void>;
  addReply: (threadId: string, input: { body: string; areaTag?: AreaTag; jobTag?: JobTag }) => Promise<void>;
  toggleLike: (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => Promise<void>;
  report: (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => Promise<void>;
  likeKey: (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => string;
}

export function useCommunity(uid?: string): UseCommunity {
  // repository はマウント間で固定（uid からバックエンドを決定）
  const repoRef = useRef<CommunityRepository>(createCommunityRepository(uid));

  const [view, setView] = useState<CommunityView>('boards');
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [areaFilter, setAreaFilterState] = useState<AreaTag | null>(null);
  const [jobFilter, setJobFilterState] = useState<JobTag | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // 板一覧 + 自分のいいね済み集合を初回ロード
  useEffect(() => {
    let alive = true;
    repoRef.current.listBoards().then((bs) => { if (alive) setBoards(bs); });
    if (hasListMyLikes(repoRef.current)) {
      repoRef.current.listMyLikes().then((keys) => { if (alive) setLikedIds(new Set(keys)); });
    }
    return () => { alive = false; };
  }, []);

  // 板 or 絞り込みが変わったらスレッド一覧を再取得
  const reloadThreads = useCallback(async (bId: string, filter: ThreadFilter) => {
    setLoading(true);
    try {
      const list = await repoRef.current.listThreads(bId, filter);
      setThreads(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!boardId) return;
    reloadThreads(boardId, { areaTag: areaFilter, jobTag: jobFilter });
  }, [boardId, areaFilter, jobFilter, reloadThreads]);

  const board = useMemo(() => boards.find((b) => b.id === boardId) ?? null, [boards, boardId]);
  const thread = useMemo(() => threads.find((t) => t.id === threadId) ?? null, [threads, threadId]);

  // ── navigation ──
  const openBoard = useCallback((id: string) => {
    setBoardId(id);
    setAreaFilterState(null);
    setJobFilterState(null);
    setView('threads');
  }, []);
  const openThread = useCallback((id: string) => { setThreadId(id); setView('thread'); }, []);
  const backToBoards = useCallback(() => setView('boards'), []);
  const backToThreads = useCallback(() => setView('threads'), []);

  const setAreaFilter = useCallback((v: AreaTag | null) => setAreaFilterState(v), []);
  const setJobFilter = useCallback((v: JobTag | null) => setJobFilterState(v), []);

  // 更新後スレッドを threads 配列に反映
  const upsertThread = useCallback((updated: Thread) => {
    setThreads((cur) => {
      const idx = cur.findIndex((t) => t.id === updated.id);
      if (idx === -1) return [updated, ...cur];
      const next = [...cur];
      next[idx] = updated;
      return next;
    });
  }, []);

  // ── mutations ──
  const createThread = useCallback(async (input: { title: string; body: string; areaTag?: AreaTag; jobTag?: JobTag }) => {
    if (!boardId) return;
    const created = await repoRef.current.createThread({ boardId, ...input });
    // 絞り込みを解除して自分のスレを確実に表示
    setAreaFilterState(null);
    setJobFilterState(null);
    upsertThread(created);
    setThreadId(created.id);
    setView('thread');
  }, [boardId, upsertThread]);

  const addReply = useCallback(async (tid: string, input: { body: string; areaTag?: AreaTag; jobTag?: JobTag }) => {
    const updated = await repoRef.current.addReply(tid, input);
    upsertThread(updated);
  }, [upsertThread]);

  const likeKey = useCallback((target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    return target.kind === 'thread' ? `t:${target.threadId}` : `r:${target.threadId}:${target.replyId}`;
  }, []);

  const toggleLike = useCallback(async (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    const key = likeKey(target);
    const liked = likedIds.has(key);
    // 表示用 liked 集合を更新（更新関数をネストしない＝ StrictMode 二重実行対策）
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (liked) next.delete(key); else next.add(key);
      return next;
    });
    const updated = await repoRef.current.toggleLike(target, liked);
    upsertThread(updated);
  }, [likedIds, likeKey, upsertThread]);

  const report = useCallback(async (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    await repoRef.current.report(target);
  }, []);

  return {
    view, boards, board, threads, thread, areaFilter, jobFilter, likedIds, loading,
    openBoard, openThread, backToBoards, backToThreads,
    setAreaFilter, setJobFilter,
    createThread, addReply, toggleLike, report, likeKey,
  };
}
