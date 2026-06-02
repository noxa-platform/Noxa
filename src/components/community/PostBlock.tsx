'use client';

/**
 * 投稿ブロック（>>1 = スレ主 / レス 共通）。完全匿名表示（名無しさん + ID）。
 */

import { useState } from 'react';
import { FONT, WINE, WINE_INK } from '@/lib/community/constants';
import { TagChips } from './ui';

const { mono, jp: fontJp } = FONT;

export function PostBlock({
  resNo, anonId, postedAt, body, areaTag, jobTag, likeCount, liked, onLike, onReport, isOp,
}: {
  resNo: number;
  anonId: string;
  postedAt: string;
  body: string;
  areaTag?: string;
  jobTag?: string;
  likeCount: number;
  liked: boolean;
  onLike: () => void;
  onReport: () => void;
  isOp?: boolean;
}) {
  const [reported, setReported] = useState(false);
  const isMine = anonId === 'あなた' || anonId === '運営';

  return (
    <article style={{ background: 'var(--noxa-surface-card)', border: isOp ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 12, color: isOp ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', fontWeight: 600 }}>{`>>${resNo}`}</span>
        <span style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)' }}>名無しさん</span>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: isMine ? WINE_INK : 'var(--noxa-text-faint)', background: isMine ? `${WINE}1A` : 'transparent', borderRadius: 4, padding: isMine ? '1px 6px' : 0 }}>{isMine ? anonId : `ID:${anonId}`}</span>
        <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-text-faint)' }}>{postedAt}</span>
      </div>

      <p style={{ fontFamily: fontJp, fontSize: 14, lineHeight: 1.8, color: 'var(--noxa-text-primary)', margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{body}</p>

      {(areaTag || jobTag) && <div style={{ marginBottom: 10 }}><TagChips areaTag={areaTag} jobTag={jobTag} /></div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid var(--noxa-divider)', paddingTop: 8 }}>
        <button type="button" onClick={onLike} aria-pressed={liked} aria-label={`いいね ${likeCount}件`} style={{ appearance: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, background: 'transparent', border: 'none', color: liked ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)' }}>
          <span aria-hidden style={{ fontSize: 14 }}>♥</span>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{likeCount}</span>
        </button>
        <button
          type="button"
          onClick={() => { setReported(true); onReport(); }}
          disabled={reported}
          aria-label="通報する"
          style={{ appearance: 'none', cursor: reported ? 'default' : 'pointer', background: 'transparent', border: 'none', color: reported ? 'var(--noxa-status-success)' : 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 11.5, minHeight: 36 }}
        >
          {reported ? '通報を受け付けました' : '通報'}
        </button>
      </div>
    </article>
  );
}
