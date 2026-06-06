'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProfilePage, type ProfilePage, type ProfileType } from '@/lib/handle';

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
  if (!page.published) return <Centered>このプロフィールは非公開です。</Centered>;

  const initial = (page.displayName || page.handle || '?').trim().charAt(0).toUpperCase();

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 20px 32px', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.16) 0%, transparent 62%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* アバター */}
        <div style={{ width: 104, height: 104, borderRadius: '50%', overflow: 'hidden', background: 'var(--noxa-surface-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--noxa-border-strong)', boxShadow: 'var(--noxa-glow-soft)', marginBottom: 16 }}>
          {page.avatar ? <img src={page.avatar} alt={page.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 44, fontFamily: 'var(--noxa-font-display-jp)', color: 'var(--noxa-text-muted)' }}>{initial}</span>}
        </div>
        <h1 style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 26, fontWeight: 500, margin: '0 0 4px', textAlign: 'center' }}>{page.displayName || page.handle}</h1>
        <div style={{ fontFamily: 'var(--noxa-font-mono)', fontSize: 12, color: 'var(--noxa-text-faint)', marginBottom: page.bio ? 12 : 20 }}>@{page.handle}</div>
        {page.bio && <p style={{ fontSize: 14, color: 'var(--noxa-text-muted)', lineHeight: 1.7, textAlign: 'center', margin: '0 0 22px', maxWidth: 400, whiteSpace: 'pre-wrap' }}>{page.bio}</p>}

        {/* SNS / リンク */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(page.sns ?? []).filter((s) => s.url).map((s, i) => {
            const meta = SNS_META[(s.platform || 'other').toLowerCase()] ?? SNS_META.other;
            return (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', textDecoration: 'none', fontSize: 15, fontWeight: 600, transition: 'transform .15s' }}>
                <span aria-hidden style={{ width: 28, height: 28, borderRadius: 8, background: meta.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>{meta.label[0]}</span>
                {meta.label}
                <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--noxa-text-faint)' }}>↗</span>
              </a>
            );
          })}
        </div>

        {/* 所属店舗 */}
        {page.shopHandle && (
          <Link href={`/s/${page.shopHandle}`} style={{ marginTop: 16, fontSize: 13, color: 'var(--noxa-accent-primary-ink)' }}>所属店舗を見る →</Link>
        )}

        <Link href="/" style={{ marginTop: 36, fontSize: 11, color: 'var(--noxa-text-faint)', textDecoration: 'none' }}>
          Powered by <span className="noxa-logo" style={{ fontSize: 13 }}>N<em>o</em>xa</span>
        </Link>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--noxa-text-muted)', fontSize: 14 }}>{children}</main>;
}

export default PublicProfile;
