'use client';

/**
 * 店舗メンバー招待の受諾ページ。
 * URL: /store/join?shop=<shopId>&code=<inviteCode>
 * ログイン必須（AuthGuard）。受諾すると members 登録＋（castなら）席回し名簿と自動紐付け。
 */
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { auth } from '@/lib/firebase/config';
import { describeFirestoreError } from '@/lib/firestore-error';

function JoinClient({ user }: { user: User }) {
  const params = useSearchParams();
  const shopId = params.get('shop') ?? '';
  const code = params.get('code') ?? '';
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [state, setState] = useState<'idle' | 'joining' | 'done'>('idle');
  const [result, setResult] = useState<{ shopName?: string; role?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!shopId || !code) {
    return <Centered>招待リンクが正しくありません（shop / code が必要です）。</Centered>;
  }

  const join = async () => {
    setState('joining'); setError(null);
    try {
      const token = await auth?.currentUser?.getIdToken();
      const res = await fetch('/api/team/redeem-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId, code, displayName: displayName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '参加に失敗しました');
      setResult({ shopName: json.shopName, role: json.role });
      setState('done');
    } catch (e) {
      setError(describeFirestoreError(e, '店舗への参加'));
      setState('idle');
    }
  };

  const roleLabel: Record<string, string> = { cast: 'キャスト', manager: '店長', accounting: '会計（レジ）' };

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 24, borderRadius: 16, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)' }}>
        {state !== 'done' ? (
          <>
            <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Store · 招待</div>
            <h1 className="noxa-display" style={{ fontSize: 22, margin: '0 0 8px' }}>お店に参加する</h1>
            <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 18px' }}>
              招待コード <code style={{ color: 'var(--noxa-accent-primary-ink)' }}>{code}</code> でメンバー登録します。
              お店で使う名前（源氏名）を確認してください。
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>お店で使う名前</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例: れいな" className="noxa-input" />
            </label>
            {error && <p style={{ color: 'var(--noxa-status-error)', fontSize: 12, margin: '0 0 12px' }}>{error}</p>}
            <button type="button" onClick={join} disabled={state === 'joining'} className="noxa-btn noxa-btn-primary" style={{ width: '100%', padding: '12px 0', fontSize: 15 }}>
              {state === 'joining' ? '参加処理中…' : '参加する'}
            </button>
          </>
        ) : (
          <>
            <h1 className="noxa-display" style={{ fontSize: 22, margin: '0 0 8px' }}>参加しました 🎉</h1>
            <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.7, margin: '0 0 18px' }}>
              {result?.shopName ? `「${result.shopName}」` : 'お店'}に{roleLabel[result?.role ?? ''] ?? result?.role}として登録されました。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Link href="/attendance" className="noxa-btn noxa-btn-primary" style={{ textAlign: 'center', padding: '12px 0', fontSize: 14, textDecoration: 'none' }}>出勤打刻へ</Link>
              <Link href="/account" style={{ textAlign: 'center', fontSize: 12, color: 'var(--noxa-text-muted)' }}>マイページへ</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--noxa-text-muted)', fontSize: 14 }}>{children}</main>;
}

export default function Page() {
  return (
    <Suspense fallback={<Centered>読み込み中…</Centered>}>
      <AuthGuard>{(user) => <JoinClient user={user} />}</AuthGuard>
    </Suspense>
  );
}
