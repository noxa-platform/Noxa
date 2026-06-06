'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { mergeWithGoogle, mergeWithApple, startLineMerge, type MergeResult } from '@/lib/auth/merge';

function MergeClient({ user }: { user: User }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<MergeResult>) => {
    setBusy(key); setError(null); setResult(null);
    try { setResult(await fn()); }
    catch (e) {
      const m = (e as Error)?.message ?? '';
      if (m === 'SAME_ACCOUNT') setError('同じアカウントが選択されました。統合元には「別の」アカウントを指定してください。');
      else if (m.includes('popup-closed') || m.includes('cancelled')) setError(null);
      else setError('統合に失敗しました。統合元アカウントでログインし直してから再試行してください。');
    }
    finally { setBusy(null); }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '8px 4px' }}>
      <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Account · Merge</div>
      <h1 className="noxa-display" style={{ fontSize: 28, margin: '0 0 6px' }}>アカウント統合</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 13, lineHeight: 1.8, margin: '0 0 4px' }}>
        いまログイン中のアカウント（<b style={{ color: 'var(--noxa-text-primary)' }}>残す方</b>：{user.email ?? user.uid}）に、
        誤って作ったもう1つのアカウントのデータを統合します。
      </p>
      <p style={{ color: 'var(--noxa-text-faint)', fontSize: 12, lineHeight: 1.7, margin: '0 0 20px' }}>
        下のボタンで<b>統合元（消す方）</b>のログイン方法を選び、その認証を行ってください。店舗オーナー権・メンバー・売上の帰属・個人データを今のアカウントへ移し、統合元は無効化します（監査ログに記録し、復元可能です）。
      </p>

      {result && (
        <div style={{ padding: '12px 14px', borderRadius: 12, marginBottom: 16, background: 'rgba(123,232,161,0.10)', border: '1px solid var(--noxa-border)' }}>
          <div style={{ color: 'var(--noxa-status-success)', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>統合が完了しました。</div>
          {result.errors && result.errors.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--noxa-status-warning)' }}>一部の項目はスキップされました：{result.errors.join(' / ')}</div>
          )}
          <Link href="/account/connections" style={{ fontSize: 13, color: 'var(--noxa-accent-primary-ink)' }}>連携設定に戻る</Link>
        </div>
      )}
      {error && <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, padding: '10px 12px', borderRadius: 10, marginBottom: 16, background: 'rgba(226,109,109,0.10)', border: '1px solid var(--noxa-border)' }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={() => run('google', mergeWithGoogle)} disabled={!!busy} className="noxa-btn noxa-btn-secondary" style={{ padding: 14, fontSize: 14 }}>
          {busy === 'google' ? '統合中…' : '統合元が Google のアカウント'}
        </button>
        <button type="button" onClick={() => run('apple', mergeWithApple)} disabled={!!busy} className="noxa-btn noxa-btn-secondary" style={{ padding: 14, fontSize: 14 }}>
          {busy === 'apple' ? '統合中…' : '統合元が Apple のアカウント'}
        </button>
        <button type="button" onClick={() => { setError(null); startLineMerge(); }} disabled={!!busy} className="noxa-btn" style={{ padding: 14, fontSize: 14, background: '#06C755', color: '#fff', border: 'none' }}>
          統合元が LINE のアカウント
        </button>
      </div>

      <p style={{ marginTop: 20, fontSize: 11, color: 'var(--noxa-text-faint)', lineHeight: 1.7 }}>
        ※ サブスクリプション等の課金情報は、今のアカウントに無い場合のみ移管します。重複課金にはご注意ください。
      </p>
      <div style={{ marginTop: 16 }}>
        <Link href="/account/connections" style={{ fontSize: 13, color: 'var(--noxa-accent-primary-ink)' }}>← 連携設定に戻る</Link>
      </div>
    </div>
  );
}

export default function Page() {
  return <AuthGuard>{(user) => <AccountShell user={user}><MergeClient user={user} /></AccountShell>}</AuthGuard>;
}
