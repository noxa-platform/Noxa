'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '@/components/AuthGuard';
import type { User } from 'firebase/auth';
import { HANDLE_RE, validateHandle, suggestHandle, isHandleAvailable, claimHandle } from '@/lib/handle';

function Onboarding({ user }: { user: User }) {
  const router = useRouter();
  // 初期値は lazy initializer で（マウント時に user は確定済み。effect での seed は不要）
  const [handle, setHandle] = useState(() => suggestHandle(user.displayName || user.email?.split('@')[0] || 'noxa'));
  // 可用性は「どのハンドルの結果か」つきで持ち、表示状態を導出（同期 setStatus は set-state-in-effect 違反）
  const [checkSnap, setCheckSnap] = useState<{ for: string; status: 'ok' | 'taken' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validH = validateHandle(handle);
  const status: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid' =
    !validH ? (handle ? 'invalid' : 'idle')
    : checkSnap?.for === validH ? checkSnap.status : 'checking';

  useEffect(() => {
    const h = validateHandle(handle);
    if (!h) return; // invalid/idle は導出
    let alive = true;
    const t = setTimeout(async () => {
      const ok = await isHandleAvailable(h);
      if (alive) setCheckSnap({ for: h, status: ok ? 'ok' : 'taken' });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [handle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = validateHandle(handle);
    if (!h) { setError('使用できないハンドルです。'); return; }
    setBusy(true); setError(null);
    try {
      await claimHandle(h, { type: 'user', ownerUid: user.uid, refId: user.uid, displayName: user.displayName ?? '', avatar: user.photoURL ?? '' });
      router.replace('/account');
    } catch (err) {
      const m = (err as Error)?.message ?? '';
      setError(m === 'HANDLE_TAKEN' ? 'このハンドルは既に使われています。' : 'ハンドルの設定に失敗しました。');
      setBusy(false);
    }
  };

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 18, padding: 'clamp(24px,4vw,36px)', boxShadow: 'var(--noxa-glow-soft)' }}>
        <Link href="/" className="noxa-logo" style={{ fontSize: 24, display: 'inline-block', marginBottom: 6 }}>N<em>o</em>xa</Link>
        <div className="noxa-eyebrow" style={{ marginBottom: 12 }}>Welcome · ハンドルを決める</div>
        <h1 className="noxa-display" style={{ fontSize: 26, margin: '0 0 8px' }}>あなたのIDを作成</h1>
        <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 20px' }}>
          公開プロフィール（リンク集）のURLになります。後から変更も可能です。<br />
          半角英数字と「_」、3〜20文字。
        </p>

        <form onSubmit={submit}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--noxa-font-mono)', color: 'var(--noxa-text-faint)', fontSize: 14 }}>noxa.egshugy.com/u/</span>
          </div>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
            placeholder="your_id"
            className="noxa-input"
            autoFocus
            pattern={HANDLE_RE.source}
          />
          <div style={{ minHeight: 20, marginTop: 6, fontSize: 12 }}>
            {status === 'checking' && <span style={{ color: 'var(--noxa-text-faint)' }}>確認中…</span>}
            {status === 'ok' && <span style={{ color: 'var(--noxa-status-success)' }}>✓ 使用できます</span>}
            {status === 'taken' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>このIDは使用済みです</span>}
            {status === 'invalid' && <span style={{ color: 'var(--noxa-accent-destructive)' }}>英数字と「_」3〜20文字で入力してください</span>}
          </div>
          {error && <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, margin: '4px 0 0' }}>{error}</p>}
          <button type="submit" disabled={busy || status !== 'ok'} className="noxa-btn noxa-btn-primary" style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 14 }}>
            {busy ? '作成中…' : 'このIDで始める'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function Page() {
  return <AuthGuard>{(user) => <Onboarding user={user} />}</AuthGuard>;
}
