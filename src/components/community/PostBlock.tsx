'use client';

/**
 * 投稿ブロック（>>1 = スレ主 / レス 共通）。完全匿名表示（名無しさん + 日替わり ID）。
 * 運営は「運営」、スレ主の再投稿は「スレ主」、自分の投稿は本人にのみ「自分」を表示する。
 */

import { useState } from 'react';
import { FONT, WINE, WINE_INK } from '@/lib/community/constants';
import { TagChips } from './ui';

const { mono, jp: fontJp } = FONT;

export function PostBlock({
  resNo, anonId, postedAt, body, areaTag, jobTag, likeCount, liked,
  isThreadAuthor, isMine, official, onLike, onReport, onEdit, onDelete, isOp,
}: {
  resNo: number;
  anonId: string;
  postedAt: string;
  body: string;
  areaTag?: string;
  jobTag?: string;
  likeCount: number;
  liked: boolean;
  isThreadAuthor?: boolean;
  isMine?: boolean;
  official?: boolean;
  onLike: () => void;
  onReport: () => void | Promise<void>;
  onEdit?: (body: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  isOp?: boolean;
}) {
  const [reported, setReported] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  // 本人の投稿のみ編集・削除可（運営投稿は対象外）
  const canManage = !!isMine && !official && (!!onEdit || !!onDelete);

  const saveEdit = async () => {
    const next = draft.trim();
    if (!onEdit || busy || next.length === 0 || next.length > 1000 || next === body) { setEditing(false); return; }
    setBusy(true);
    try { await onEdit(next); setEditing(false); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!onDelete || busy) return;
    if (!window.confirm(isOp ? 'このスレッドを削除しますか？（元に戻せません）' : 'このレスを削除しますか？（元に戻せません）')) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  };

  return (
    <article style={{ background: 'var(--noxa-surface-card)', border: isOp ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 12, color: isOp ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', fontWeight: 600 }}>{`>>${resNo}`}</span>

        {official ? (
          <span style={{ fontFamily: fontJp, fontSize: 12.5, fontWeight: 700, color: WINE_INK }}>運営</span>
        ) : (
          <>
            <span style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)' }}>名無しさん</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-text-faint)' }}>{`ID:${anonId}`}</span>
          </>
        )}

        {/* スレ主バッジ（レス側で >>1 と同一投稿者のとき） */}
        {!isOp && isThreadAuthor && !official && (
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--noxa-accent-primary-ink)', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(184,156,251,0.3)', borderRadius: 9999, padding: '1px 7px' }}>スレ主</span>
        )}

        {/* 自分マーク（本人にのみ表示） */}
        {isMine && (
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: '0.06em', color: WINE_INK, background: `${WINE}1A`, border: `1px solid ${WINE}44`, borderRadius: 9999, padding: '1px 7px' }}>自分</span>
        )}

        <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-text-faint)' }}>{postedAt}</span>
      </div>

      {editing ? (
        <div style={{ marginBottom: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={1000}
            autoFocus
            style={{ width: '100%', fontFamily: fontJp, fontSize: 14, lineHeight: 1.7, color: 'var(--noxa-text-primary)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 10, padding: 10, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <button type="button" disabled={busy} onClick={saveEdit} style={{ appearance: 'none', cursor: 'pointer', background: 'var(--noxa-accent-primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontFamily: mono, fontSize: 12, minHeight: 34 }}>{busy ? '保存中…' : '保存'}</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(body); setEditing(false); }} style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', borderRadius: 8, padding: '6px 14px', fontFamily: mono, fontSize: 12, minHeight: 34 }}>キャンセル</button>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-text-faint)', marginLeft: 'auto' }}>{draft.length}/1000</span>
          </div>
        </div>
      ) : (
        <p style={{ fontFamily: fontJp, fontSize: 14, lineHeight: 1.8, color: 'var(--noxa-text-primary)', margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{body}</p>
      )}

      {!editing && (areaTag || jobTag) && <div style={{ marginBottom: 10 }}><TagChips areaTag={areaTag} jobTag={jobTag} /></div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid var(--noxa-divider)', paddingTop: 8 }}>
        <button type="button" onClick={onLike} aria-pressed={liked} aria-label={`いいね ${likeCount}件`} style={{ appearance: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, background: 'transparent', border: 'none', color: liked ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)' }}>
          <span aria-hidden style={{ fontSize: 14 }}>♥</span>
          <span style={{ fontFamily: mono, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{likeCount}</span>
        </button>
        {/* 自分の投稿は通報不可 */}
        {!isMine && (
          <button
            type="button"
            onClick={async () => {
              // 通報は取り消せず、集まると自動非表示に繋がる。誤タップ防止に確認を挟む。
              if (!window.confirm(isOp ? 'このスレッドを通報しますか？' : 'このレスを通報しますか？')) return;
              setReported(true); // 楽観表示
              try {
                await onReport();
              } catch {
                // 送信失敗時は巻き戻す（「受け付けました」の誤表示を残さない・Day47 like と同型）
                setReported(false);
              }
            }}
            disabled={reported}
            aria-label="通報する"
            style={{ appearance: 'none', cursor: reported ? 'default' : 'pointer', background: 'transparent', border: 'none', color: reported ? 'var(--noxa-status-success)' : 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 11.5, minHeight: 36 }}
          >
            {reported ? '通報を受け付けました' : '通報'}
          </button>
        )}

        {/* 本人の投稿は編集・削除可 */}
        {canManage && !editing && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, marginLeft: 'auto' }}>
            {onEdit && (
              <button type="button" onClick={() => { setDraft(body); setEditing(true); }} aria-label="編集する" style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 11.5, minHeight: 36 }}>編集</button>
            )}
            {onDelete && (
              <button type="button" onClick={doDelete} disabled={busy} aria-label="削除する" style={{ appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--noxa-status-error)', fontFamily: mono, fontSize: 11.5, minHeight: 36 }}>削除</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
