'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useWorkspaces, setActiveShop } from '@/lib/workspace';

/**
 * ワークスペース切替（個人 / 各店舗）。サイドメニュー上部に常設。
 * 複数店舗・個人を1ユーザーが持てるため、ここで「今操作する対象」を切り替える。
 * 切替時は全リゾルバを確実に再解決するためリロード（誤店舗操作を防ぐ）。
 */
export function WorkspaceSwitcher({ user }: { user: User }) {
  const ws = useWorkspaces(user);
  const [open, setOpen] = useState(false);

  if (ws.loading) return null;
  if (ws.items.length === 0) return null; // 店舗が無い＝個人のみ。切替不要

  const activeName = ws.activeId === 'personal'
    ? '個人（マイページ）'
    : (ws.items.find((i) => i.id === ws.activeId)?.name ?? '選択してください');

  const choose = (v: string) => {
    setActiveShop(v);
    if (typeof window !== 'undefined') window.location.reload();
  };

  const row = (key: string, label: string, sub: string, on: boolean) => (
    <button key={key} type="button" onClick={() => choose(key)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '12px 12px', borderRadius: 10, cursor: 'pointer',
        background: on ? 'rgba(139,92,246,0.14)' : 'transparent', border: 'none', color: 'var(--noxa-text-primary)' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: on ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, fontWeight: on ? 700 : 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>{sub}</span>
    </button>
  );

  return (
    <div style={{ padding: '0 6px 12px' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
          background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border-strong)', color: 'var(--noxa-text-primary)' }}>
        <span aria-hidden style={{ fontSize: 18 }}>🏪</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--noxa-text-faint)' }}>今の場所</span>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--noxa-font-display-jp)' }}>{activeName}</span>
        </span>
        <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>切替 {open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 6, padding: 6, borderRadius: 12, background: 'var(--noxa-bg-elevated)', border: '1px solid var(--noxa-border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {row('personal', '個人（マイページ）', '個人', ws.activeId === 'personal')}
          {ws.items.map((i) => row(i.id, i.name, i.role === 'owner' ? 'オーナー' : 'スタッフ', ws.activeId === i.id))}
        </div>
      )}
    </div>
  );
}

export default WorkspaceSwitcher;
