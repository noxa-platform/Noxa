'use client';

import { useState } from 'react';
import type { AuthCredential, User } from 'firebase/auth';
import { completeLinkWithPassword } from '@/lib/auth';

/**
 * 同一メールが既にメール/パスワードで登録済みのとき、パスワードを入力して
 * OAuth(Google/Apple)資格情報を既存アカウントにリンクするダイアログ。
 */
export function LinkAccountDialog({
  email, pendingCred, onLinked, onCancel,
}: {
  email: string;
  pendingCred: AuthCredential;
  onLinked: (user: User) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const user = await completeLinkWithPassword(email, password, pendingCred);
      onLinked(user);
    } catch {
      setError('パスワードが違うか、リンクに失敗しました。');
      setBusy(false);
    }
  };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: '100%', maxWidth: 400, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 24, boxShadow: 'var(--noxa-glow-soft)' }}>
        <h3 style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 18, margin: '0 0 8px' }}>アカウントを連携</h3>
        <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)', lineHeight: 1.7, margin: '0 0 16px' }}>
          <b style={{ color: 'var(--noxa-text-primary)' }}>{email}</b> は既にメール／パスワードで登録済みです。<br />
          パスワードを入力すると、今回の方法をこの既存アカウントに連携します（同一アカウントになります）。
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          className="noxa-input"
          autoFocus
          required
        />
        {error && <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, margin: '10px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button type="submit" disabled={busy} className="noxa-btn noxa-btn-primary" style={{ flex: 1, padding: '12px', fontSize: 14 }}>
            {busy ? '連携中…' : '連携してログイン'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="noxa-btn noxa-btn-secondary" style={{ padding: '12px 18px', fontSize: 14 }}>
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}

export default LinkAccountDialog;
