'use client';

/**
 * スレッド一覧（板内）。ピン留め優先・エリア/職種タグで絞り込み・スレッド作成。
 */

import { useState } from 'react';
import { AREA_TAGS, FONT, JOB_TAGS, WINE, WINE_INK } from '@/lib/community/constants';
import type { AreaTag, Board, JobTag, Thread } from '@/lib/community/types';
import { ThreadComposer } from './composers';
import { EmptyState, FilterRow, SectionLabel, TagChips, primaryBtn } from './ui';

const { mono, jp: fontJp } = FONT;

export function ThreadList({
  board, threads, areaFilter, jobFilter, onAreaFilter, onJobFilter, onOpenThread, onCreate,
}: {
  board: Board;
  threads: Thread[];
  areaFilter: AreaTag | null;
  jobFilter: JobTag | null;
  onAreaFilter: (v: AreaTag | null) => void;
  onJobFilter: (v: JobTag | null) => void;
  onOpenThread: (id: string) => void;
  onCreate: (title: string, body: string, area?: AreaTag, job?: JobTag) => void;
}) {
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <section aria-label={`${board.name} のスレッド一覧`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontFamily: fontJp, fontSize: 19, fontWeight: 700, color: 'var(--noxa-text-primary)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            {board.name}
            {board.featured && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', color: WINE_INK, background: `${WINE}22`, border: `1px solid ${WINE}55`, borderRadius: 9999, padding: '2px 8px' }}>差別化板</span>}
          </h2>
          <p style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)', margin: 0 }}>{board.desc}</p>
        </div>
        <button type="button" onClick={() => setComposerOpen((v) => !v)} style={primaryBtn(true)} aria-label="スレッドを立てる">
          {composerOpen ? '閉じる' : '＋ スレッドを立てる'}
        </button>
      </div>

      {composerOpen && (
        <ThreadComposer onSubmit={(title, body, area, job) => { onCreate(title, body, area, job); setComposerOpen(false); }} />
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        <FilterRow label="エリア" tags={AREA_TAGS} active={areaFilter} onPick={(v) => onAreaFilter(v as AreaTag | null)} />
        <FilterRow label="職種" tags={JOB_TAGS} active={jobFilter} onPick={(v) => onJobFilter(v as JobTag | null)} />
      </div>

      {threads.length === 0 ? (
        <EmptyState />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {threads.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpenThread(t.id)} aria-label={`${t.title} を開く`} style={{ appearance: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', background: 'var(--noxa-surface-card)', border: t.pinned ? `1px solid ${WINE}55` : '1px solid var(--noxa-border)', borderRadius: 12, padding: '13px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  {t.pinned && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', color: WINE_INK, background: `${WINE}22`, borderRadius: 4, padding: '1px 6px' }}>ピン留め</span>}
                  <span style={{ fontFamily: fontJp, fontSize: 14.5, fontWeight: 600, color: 'var(--noxa-text-primary)', lineHeight: 1.5 }}>{t.title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <TagChips areaTag={t.areaTag} jobTag={t.jobTag} small />
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-accent-primary-ink)', fontVariantNumeric: 'tabular-nums' }}>レス {(t.replyCount ?? t.replies.length) + 1}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)' }}>最終 {t.lastActivity}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
