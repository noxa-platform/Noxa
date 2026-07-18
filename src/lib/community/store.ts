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
import { isFirestoreCommunityBackend, type CommunityRepository } from './repository';
import { MockCommunityRepository } from './mock-repository';
import { FirestoreCommunityRepository } from './firestore-repository';
import { setLikeKey } from './like-state';

export type CommunityView = 'boards' | 'threads' | 'thread';

/**
 * repository ファクトリ（差し替えポイント）。
 * 既定は Firestore（Day10 本番化）。NEXT_PUBLIC_COMMUNITY_BACKEND=mock で明示した場合と
 * uid が無い（未ログイン）場合のみ Mock＝Firebase 未設定でもローカル閲覧が壊れない。
 */
export function createCommunityRepository(uid?: string): CommunityRepository {
  if (isFirestoreCommunityBackend() && uid) {
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
  editThread: (threadId: string, body: string) => Promise<void>;
  editReply: (threadId: string, replyId: string, body: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  deleteReply: (threadId: string, replyId: string) => Promise<void>;
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
  // スレッド一覧は「どの板×絞り込みの結果か」キーつきで保持し loading を導出
  // （reloadThreads 冒頭の同期 setLoading は set-state-in-effect 違反・Day21 返済）
  const [threadsSnap, setThreadsSnap] = useState<{ key: string; list: Thread[] } | null>(null);
  const [areaFilter, setAreaFilterState] = useState<AreaTag | null>(null);
  const [jobFilter, setJobFilterState] = useState<JobTag | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const threadsKey = boardId ? `${boardId}|${areaFilter ?? ''}|${jobFilter ?? ''}` : null;
  const threads = useMemo(
    () => (threadsKey && threadsSnap?.key === threadsKey ? threadsSnap.list : []),
    [threadsSnap, threadsKey],
  );
  const loading = !!threadsKey && threadsSnap?.key !== threadsKey;

  // 板一覧 + 自分のいいね済み集合を初回ロード
  useEffect(() => {
    let alive = true;
    repoRef.current.listBoards().then((bs) => { if (alive) setBoards(bs); });
    if (hasListMyLikes(repoRef.current)) {
      repoRef.current.listMyLikes().then((keys) => { if (alive) setLikedIds(new Set(keys)); });
    }
    return () => { alive = false; };
  }, []);

  // 板 or 絞り込みが変わったらスレッド一覧を再取得。
  // 最後に要求したキーを ref に控え、古い応答は破棄する（破棄しないと遅い旧応答が
  // 新しいスナップを後から上書き→キー不一致で loading に戻ったまま再取得も走らない）
  const reloadKeyRef = useRef<string | null>(null);
  const reloadThreads = useCallback(async (bId: string, filter: ThreadFilter) => {
    const key = `${bId}|${filter.areaTag ?? ''}|${filter.jobTag ?? ''}`;
    reloadKeyRef.current = key;
    try {
      const list = await repoRef.current.listThreads(bId, filter);
      if (reloadKeyRef.current === key) setThreadsSnap({ key, list });
    } catch {
      if (reloadKeyRef.current === key) setThreadsSnap({ key, list: [] }); // 失敗でもキーを確定し loading を解く
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
    setThreadsSnap((cur) => {
      if (!cur) return cur;
      const idx = cur.list.findIndex((t) => t.id === updated.id);
      const next = idx === -1 ? [updated, ...cur.list] : cur.list.map((t, i) => (i === idx ? updated : t));
      return { ...cur, list: next };
    });
  }, []);

  // ── mutations ──
  const createThread = useCallback(async (input: { title: string; body: string; areaTag?: AreaTag; jobTag?: JobTag }) => {
    if (!boardId) return;
    const created = await repoRef.current.createThread({ boardId, ...input });
    // 絞り込みを解除して自分のスレを確実に表示。
    // キーも解除後（絞り込みなし）で確定させ、再取得完了前でも作成スレを即表示する
    setAreaFilterState(null);
    setJobFilterState(null);
    setThreadsSnap((cur) => ({ key: `${boardId}||`, list: [created, ...(cur?.list.filter((t) => t.id !== created.id) ?? [])] }));
    setThreadId(created.id);
    setView('thread');
  }, [boardId]);

  const addReply = useCallback(async (tid: string, input: { body: string; areaTag?: AreaTag; jobTag?: JobTag }) => {
    const updated = await repoRef.current.addReply(tid, input);
    upsertThread(updated);
  }, [upsertThread]);

  const editThread = useCallback(async (tid: string, body: string) => {
    const updated = await repoRef.current.editThread(tid, { body });
    upsertThread(updated);
  }, [upsertThread]);

  const editReply = useCallback(async (tid: string, replyId: string, body: string) => {
    const updated = await repoRef.current.editReply(tid, replyId, { body });
    upsertThread(updated);
  }, [upsertThread]);

  const deleteThread = useCallback(async (tid: string) => {
    await repoRef.current.deleteThread(tid);
    setThreadsSnap((cur) => (cur ? { ...cur, list: cur.list.filter((t) => t.id !== tid) } : cur));
    setThreadId(null);
    setView('threads');
  }, []);

  const deleteReply = useCallback(async (tid: string, replyId: string) => {
    const updated = await repoRef.current.deleteReply(tid, replyId);
    upsertThread(updated);
  }, [upsertThread]);

  const likeKey = useCallback((target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    return target.kind === 'thread' ? `t:${target.threadId}` : `r:${target.threadId}:${target.replyId}`;
  }, []);

  const toggleLike = useCallback(async (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    const key = likeKey(target);
    const liked = likedIds.has(key);
    // 表示用 liked 集合を楽観更新（点いていれば消す/なければ点ける）。
    setLikedIds((prev) => setLikeKey(prev, key, !liked));
    try {
      const updated = await repoRef.current.toggleLike(target, liked);
      upsertThread(updated);
    } catch {
      // 失敗時は楽観更新を巻き戻す。従来は握りつぶしで「ハートは点いたのに backend 未記録」の
      // 表示ズレが再マウントまで残っていた（呼び出しは fire-and-forget のため rethrow はしない）。
      setLikedIds((prev) => setLikeKey(prev, key, liked));
    }
  }, [likedIds, likeKey, upsertThread]);

  const report = useCallback(async (target: { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string }) => {
    await repoRef.current.report(target);
  }, []);

  return {
    view, boards, board, threads, thread, areaFilter, jobFilter, likedIds, loading,
    openBoard, openThread, backToBoards, backToThreads,
    setAreaFilter, setJobFilter,
    createThread, addReply, editThread, editReply, deleteThread, deleteReply, toggleLike, report, likeKey,
  };
}
