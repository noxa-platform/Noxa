'use client';

/**
 * スレッド詳細。>>1（スレ主）+ レス（1段フラット）+ 返信フォーム。
 */

import { FONT, WINE, WINE_INK } from '@/lib/community/constants';
import type { AreaTag, Board, JobTag, Thread } from '@/lib/community/types';
import { ReplyComposer } from './composers';
import { PostBlock } from './PostBlock';

const { mono, jp: fontJp } = FONT;

type LikeTarget = { kind: 'thread'; threadId: string } | { kind: 'reply'; threadId: string; replyId: string };

export function ThreadDetail({
  thread, board, likedIds, likeKey, onToggleLike, onReport, onReply, onBack,
}: {
  thread: Thread;
  board: Board | null;
  likedIds: Set<string>;
  likeKey: (t: LikeTarget) => string;
  onToggleLike: (t: LikeTarget) => void;
  onReport: (t: LikeTarget) => void;
  onReply: (body: string, area?: AreaTag, job?: JobTag) => void;
  onBack: () => void;
}) {
  return (
    <section aria-label="スレッド詳細">
      <button type="button" onClick={onBack} style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--noxa-accent-primary-ink)', fontFamily: mono, fontSize: 12, padding: '4px 0', marginBottom: 10 }}>
        ‹ {board?.name ?? '板'} に戻る
      </button>

      <h2 style={{ fontFamily: fontJp, fontSize: 'clamp(17px, 3vw, 21px)', fontWeight: 700, color: 'var(--noxa-text-primary)', margin: '0 0 14px', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        {thread.pinned && <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', color: WINE_INK, background: `${WINE}22`, borderRadius: 4, padding: '3px 7px', flexShrink: 0, marginTop: 4 }}>ピン留め</span>}
        {thread.title}
      </h2>

      {/* >>1（スレ主） */}
      <PostBlock
        resNo={1}
        anonId={thread.anonId}
        postedAt={thread.postedAt}
        body={thread.body}
        areaTag={thread.areaTag}
        jobTag={thread.jobTag}
        likeCount={thread.likeCount}
        liked={likedIds.has(likeKey({ kind: 'thread', threadId: thread.id }))}
        isMine={thread.isMine}
        official={thread.official}
        onLike={() => onToggleLike({ kind: 'thread', threadId: thread.id })}
        onReport={() => onReport({ kind: 'thread', threadId: thread.id })}
        isOp
      />

      {/* レス（1段フラット） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {thread.replies.map((r) => {
          const target: LikeTarget = { kind: 'reply', threadId: thread.id, replyId: r.id };
          return (
            <PostBlock
              key={r.id}
              resNo={r.resNo}
              anonId={r.anonId}
              postedAt={r.postedAt}
              body={r.body}
              areaTag={r.areaTag}
              jobTag={r.jobTag}
              likeCount={r.likeCount}
              liked={likedIds.has(likeKey(target))}
              isThreadAuthor={r.isThreadAuthor}
              isMine={r.isMine}
              official={r.official}
              onLike={() => onToggleLike(target)}
              onReport={() => onReport(target)}
            />
          );
        })}
      </div>

      <ReplyComposer onSubmit={onReply} />
    </section>
  );
}
