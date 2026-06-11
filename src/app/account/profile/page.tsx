'use client';
import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

function ProfileEditor({ user }: { user: User }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, `account_users/${user.uid}`));
      if (snap.exists()) {
        const d = snap.data();
        if (d.displayName && !displayName) setDisplayName(d.displayName);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  async function save() {
    setSaving(true);
    try {
      await updateProfile(user, { displayName });
      await setDoc(
        doc(db, `account_users/${user.uid}`),
        { displayName, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Account · Profile</div>
      <h1 className="noxa-h1" style={{ margin: '0 0 32px' }}>プロフィール</h1>

      <div className="noxa-card" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label className="noxa-label" htmlFor="displayName">表示名</label>
          <input
            id="displayName"
            type="text"
            className="noxa-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: 凛"
          />
        </div>
        <div>
          <label className="noxa-label" htmlFor="email">メールアドレス（変更不可）</label>
          <input
            id="email"
            type="email"
            className="noxa-input"
            value={user.email ?? ''}
            disabled
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="noxa-btn noxa-btn-primary"
          style={{ padding: '12px 24px', fontSize: 14, alignSelf: 'flex-start' }}
        >
          {saving ? '保存中…' : saved ? '保存しました ✓' : '保存'}
        </button>
      </div>

      <div className="noxa-card" style={{ maxWidth: 640, marginTop: 20 }}>
        <ThemeSwitcher />
      </div>
    </AccountShell>
  );
}

export default function ProfilePage() {
  return <AuthGuard>{(user) => <ProfileEditor user={user} />}</AuthGuard>;
}
