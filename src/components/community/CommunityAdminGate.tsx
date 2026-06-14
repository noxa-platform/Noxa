'use client';

/** 管理画面ゲート: ログイン必須 + platformRole=admin のみ。 */

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { FONT } from '@/lib/community/constants';
import { fetchCommunityMe } from '@/lib/community/api';
import { CommunityAdminClient } from './CommunityAdminClient';

const { mono } = FONT;

function AdminOnly({ user }: { user: User }) {
  const [state, setState] = useState<'loading' | 'allow' | 'deny'>('loading');
  useEffect(() => {
    fetchCommunityMe().then((me) => setState(me.isAdmin ? 'allow' : 'deny')).catch(() => setState('deny'));
  }, []);

  if (state === 'loading') {
    return <Center>読み込み中…</Center>;
  }
  if (state === 'deny') {
    return <Center>このページは管理者専用です。</Center>;
  }
  return <CommunityAdminClient user={user} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--noxa-bg-base)' }}>
      <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--noxa-text-muted)' }}>{children}</span>
    </main>
  );
}

export function CommunityAdminGate() {
  return <AuthGuard>{(user) => <AdminOnly user={user} />}</AuthGuard>;
}
