'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProfilePage, resolveVisibility, type ProfilePage, type ProfileType } from '@/lib/handle';
import { normalizeBlocks, type ProfileBlock } from '@/lib/profile-blocks';

const SNS_META: Record<string, { label: string; color: string }> = {
  instagram: { label: 'Instagram', color: '#E1306C' },
  x: { label: 'X', color: '#000000' },
  twitter: { label: 'X', color: '#000000' },
  tiktok: { label: 'TikTok', color: '#010101' },
  line: { label: 'LINE', color: '#06C755' },
  youtube: { label: 'YouTube', color: '#FF0000' },
  other: { label: 'リンク', color: 'var(--noxa-accent-primary)' },
};

export function PublicProfile({ handle, expectType }: { handle: string; expectType: ProfileType }) {
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getProfilePage(handle).then((p) => { if (alive) { setPage(p); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [handle]);

  if (loading) return <Centered>読み込み中…</Centered>;
  if (!page || page.type !== expectType) return <Centered>このプロフィールは見つかりませんでした。</Centered>;
  // private は非公開表示（public/unlisted は描画。read自体はルールで担保済み・二重防御）
  if (resolveVisibility(page) === 'private') return <Centered>このプロフィールは非公開です。</Centered>;

  const initial = (page.displayName || page.handle || '?').trim().charAt(0).toUpperCase();

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 20px 32px', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.16) 0%, transparent 62%)', pointerEvents: 'none' }} />
      <style>{`
        .noxa-link-btn { transition: transform .16s var(--noxa-ease-natural,ease), border-color .16s, box-shadow .16s; }
        .noxa-link-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.28); }
        .noxa-link-btn:active { transform: translateY(0); }
      `}</style>
      <div style={{ position: 'relative', width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* アバター（リング演出） */}
        <div style={{ padding: 3, borderRadius: '50%', background: 'linear-gradient(135deg, var(--noxa-accent-primary), var(--noxa-accent-primary-neon))', boxShadow: 'var(--noxa-glow-soft)', marginBottom: 16 }}>
          <div style={{ width: 104, height: 104, borderRadius: '50%', overflow: 'hidden', background: 'var(--noxa-bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {page.avatar ? <img src={page.avatar} alt={page.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 44, fontFamily: 'var(--noxa-font-display-jp)', color: 'var(--noxa-text-muted)' }}>{initial}</span>}
          </div>
        </div>
        <h1 style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 26, fontWeight: 500, margin: '0 0 4px', textAlign: 'center' }}>{page.displayName || page.handle}</h1>
        <div style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 12, color: 'var(--noxa-text-faint)', marginBottom: page.bio ? 12 : 20 }}>@{page.handle}</div>
        <PageBody page={page} />

        <Link href="/" style={{ marginTop: 36, fontSize: 11, color: 'var(--noxa-text-faint)', textDecoration: 'none' }}>
          Powered by <span className="noxa-logo" style={{ fontSize: 13 }}>N<em>o</em>xa</span>
        </Link>
      </div>
    </main>
  );
}

/**
 * ページ本文。blocks（正本）があればブロック描画、無ければ旧 bio/sns から描画（後方互換）。
 * normalizeBlocks が壊れブロック/未知typeを捨てるため、どんなデータでも落ちない。
 */
function PageBody({ page }: { page: ProfilePage }) {
  const blocks = normalizeBlocks(page.blocks).filter((b) => b.visible);
  if (blocks.length === 0) return <LegacyBody page={page} />;
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </div>
  );
}

function BlockView({ block }: { block: ProfileBlock }) {
  if (block.type === 'text') {
    return <p style={{ fontSize: 14, color: 'var(--noxa-text-muted)', lineHeight: 1.7, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>{block.value}</p>;
  }
  if (block.type === 'schedule') {
    return (
      <section style={{ padding: '14px 18px', borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)' }}>
        <div className="noxa-eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Schedule · 出勤予定</div>
        <p style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 13, lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{block.value}</p>
      </section>
    );
  }
  // link
  const meta = SNS_META[(block.platform || 'other').toLowerCase()] ?? SNS_META.other;
  const label = block.label || meta.label;
  return (
    <a href={block.url} target="_blank" rel="noopener noreferrer" className="noxa-link-btn"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 14, background: 'var(--noxa-surface-card)', borderLeft: `3px solid ${meta.color}`, borderTop: '1px solid var(--noxa-border)', borderRight: '1px solid var(--noxa-border)', borderBottom: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', textDecoration: 'none', fontSize: 15, fontWeight: 600 }}>
      <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: meta.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flex: 'none' }}>{(label || meta.label)[0]}</span>
      {label}
      <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--noxa-text-faint)' }}>↗</span>
    </a>
  );
}

/** 旧フィールド（bio/sns）での描画（blocks 未移行ページの後方互換） */
function LegacyBody({ page }: { page: ProfilePage }) {
  const links = (page.sns ?? []).filter((s) => s.url);
  return (
    <>
      {page.bio && <p style={{ fontSize: 14, color: 'var(--noxa-text-muted)', lineHeight: 1.7, textAlign: 'center', margin: '0 0 22px', maxWidth: 400, whiteSpace: 'pre-wrap' }}>{page.bio}</p>}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {links.map((s, i) => {
          const meta = SNS_META[(s.platform || 'other').toLowerCase()] ?? SNS_META.other;
          return (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="noxa-link-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 14, background: 'var(--noxa-surface-card)', borderLeft: `3px solid ${meta.color}`, borderTop: '1px solid var(--noxa-border)', borderRight: '1px solid var(--noxa-border)', borderBottom: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', textDecoration: 'none', fontSize: 15, fontWeight: 600 }}>
              <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: meta.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flex: 'none' }}>{meta.label[0]}</span>
              {meta.label}
              <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--noxa-text-faint)' }}>↗</span>
            </a>
          );
        })}
        {links.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--noxa-text-faint)', fontSize: 13, padding: '12px 0' }}>リンクは準備中です。</p>
        )}
      </div>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--noxa-text-muted)', fontSize: 14 }}>{children}</main>;
}

export default PublicProfile;
