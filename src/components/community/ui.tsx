'use client';

/**
 * コミュニティ共通の小物コンポーネントとスタイルヘルパー。
 * デザイントークンは globals.css の CSS 変数（--noxa-*）を参照する。
 */

import type { CSSProperties, ReactNode } from 'react';
import { AREA_TAGS, FONT, JOB_TAGS, WINE, WINE_INK } from '@/lib/community/constants';
import type { AreaTag, JobTag } from '@/lib/community/types';

const { mono, jp: fontJp } = FONT;

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12, display: 'block' }}>{children}</h2>;
}

export function TagChips({ areaTag, jobTag, small }: { areaTag?: string; jobTag?: string; small?: boolean }) {
  if (!areaTag && !jobTag) return null;
  const fs = small ? 10 : 11;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {areaTag && <span style={{ fontFamily: mono, fontSize: fs, color: 'var(--noxa-accent-primary-ink)', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(184,156,251,0.25)', borderRadius: 9999, padding: '2px 8px' }}>{areaTag}</span>}
      {jobTag && <span style={{ fontFamily: mono, fontSize: fs, color: WINE_INK, background: `${WINE}18`, border: `1px solid ${WINE}44`, borderRadius: 9999, padding: '2px 8px' }}>{jobTag}</span>}
    </span>
  );
}

export function FilterRow({ label, tags, active, onPick }: { label: string; tags: readonly string[]; active: string | null; onPick: (v: string | null) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 2 }}>{label}</span>
      {tags.map((t) => {
        const on = active === t;
        return (
          <button key={t} type="button" onClick={() => onPick(on ? null : t)} aria-pressed={on} style={{ appearance: 'none', cursor: 'pointer', minHeight: 30, padding: '3px 10px', borderRadius: 9999, background: on ? 'rgba(139,92,246,0.18)' : 'var(--noxa-surface-muted)', border: on ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)', color: on ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)', fontFamily: mono, fontSize: 11 }}>{t}</button>
        );
      })}
    </div>
  );
}

export function TagPickers({ area, job, onArea, onJob }: { area?: AreaTag; job?: JobTag; onArea: (v?: AreaTag) => void; onJob: (v?: JobTag) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <select value={area ?? ''} onChange={(e) => onArea((e.target.value || undefined) as AreaTag | undefined)} aria-label="エリアタグ" style={selectStyle()}>
        <option value="">エリア（任意）</option>
        {AREA_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={job ?? ''} onChange={(e) => onJob((e.target.value || undefined) as JobTag | undefined)} aria-label="職種タグ" style={selectStyle()}>
        <option value="">職種（任意）</option>
        {JOB_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}

export function EmptyState() {
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px dashed var(--noxa-border)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
      <p style={{ fontFamily: fontJp, fontSize: 13.5, color: 'var(--noxa-text-muted)', margin: '0 0 4px' }}>この条件のスレッドはまだありません。</p>
      <p style={{ fontFamily: fontJp, fontSize: 12, color: 'var(--noxa-text-faint)', margin: 0 }}>絞り込みを外すか、最初のスレッドを立ててみてください。</p>
    </div>
  );
}

// ── スタイルヘルパー ──

export function crumbBtn(active: boolean): CSSProperties {
  return { appearance: 'none', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)' };
}

export function primaryBtn(enabled: boolean): CSSProperties {
  return {
    appearance: 'none', cursor: enabled ? 'pointer' : 'not-allowed', minHeight: 40, padding: '9px 18px', borderRadius: 10,
    border: '1px solid var(--noxa-accent-primary)',
    background: enabled ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-hover)',
    color: enabled ? '#fff' : 'var(--noxa-text-faint)',
    fontFamily: fontJp, fontSize: 13.5, fontWeight: 600,
    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
    flexShrink: 0,
  };
}

export function cardBox(): CSSProperties {
  return { background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 16, marginBottom: 14 };
}

export function inputStyle(): CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', background: 'var(--noxa-bg-elevated)', border: '1px solid var(--noxa-border)',
    borderRadius: 10, padding: '10px 12px', color: 'var(--noxa-text-primary)', fontFamily: fontJp,
    fontSize: 16 /* iOS auto-zoom 回避 */, lineHeight: 1.6, outline: 'none', display: 'block',
  };
}

export function selectStyle(): CSSProperties {
  return {
    appearance: 'none', background: 'var(--noxa-bg-elevated)', border: '1px solid var(--noxa-border)', borderRadius: 9999,
    padding: '6px 12px', color: 'var(--noxa-text-muted)', fontFamily: mono, fontSize: 12, cursor: 'pointer', minHeight: 32,
  };
}
