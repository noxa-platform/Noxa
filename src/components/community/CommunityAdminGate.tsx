'use client';

/** 管理画面ゲート: ログイン必須 + platformRole=admin のみ。 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    return <Center><span style={{ fontFamily: mono, fontSize: 13, color: 'var(--noxa-text-muted)' }}>読み込み中…</span></Center>;
  }
  if (state === 'deny') {
    // 弾いたら戻り道を必ず出す（Day113）。旧実装は全画面の文言だけで、ブラウザの
    // 戻る操作を知らない利用者はここで手詰まりだった。
    return (
      <Center>
        <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--noxa-text-muted)' }}>このページは管理者専用です。</span>
        <ExitLinks />
      </Center>
    );
  }
  return <CommunityAdminClient user={user} />;
}

/** ゲートで弾かれた画面からの戻り道 */
function ExitLinks() {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
      <Link href="/community" style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-accent-primary-ink)' }}>← コミュニティへ</Link>
      <Link href="/account" style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-muted)' }}>Noxa OS へ</Link>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', justifyContent: 'center', background: 'var(--noxa-bg-base)', padding: 20, textAlign: 'center' }}>
      {children}
    </main>
  );
}

export function CommunityAdminGate() {
  return <AuthGuard>{(user) => <AdminOnly user={user} />}</AuthGuard>;
}
