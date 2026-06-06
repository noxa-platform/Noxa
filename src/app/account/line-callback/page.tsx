'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { finishLineLogin } from '@/lib/auth/line';
import { isLineMergePending, finishLineMerge } from '@/lib/auth/merge';
import { handlePostLoginRedirect } from '@/lib/auth';

function LineCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const code = params.get('code');
    const state = params.get('state');
    const errParam = params.get('error');
    if (errParam) { setError('LINEログインがキャンセルされました。'); return; }
    if (!code || !state) { setError('不正なコールバックです。'); return; }
    // 統合フロー（既存アカウントへ LINE 由来アカウントを統合）
    if (isLineMergePending()) {
      finishLineMerge(code, state)
        .then(() => router.push('/account/connections?merged=1'))
        .catch((e) => { console.error('[line-merge]', e); setError('LINE アカウントの統合に失敗しました。'); });
      return;
    }
    finishLineLogin(code, state)
      .then((redirect) => handlePostLoginRedirect(redirect, router))
      .catch((e) => { console.error('[line-callback]', e); setError('LINEログインに失敗しました。もう一度お試しください。'); });
  }, [params, router]);

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <Link href="/" className="noxa-logo" style={{ fontSize: 26, display: 'inline-block', marginBottom: 18 }}>N<em>o</em>xa</Link>
        {error ? (
          <>
            <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 14, lineHeight: 1.7 }}>{error}</p>
            <Link href="/account/login" style={{ color: 'var(--noxa-accent-primary-ink)', fontSize: 13 }}>ログイン画面に戻る</Link>
          </>
        ) : (
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14 }}>LINE でログイン中…</p>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense fallback={null}><LineCallback /></Suspense>;
}
