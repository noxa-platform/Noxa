'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { ProModeSwitcher } from '@/components/ProModeSwitcher';
import { db } from '@/lib/firebase/config';
import { describeFirestoreError } from '@/lib/firestore-error';
import type { User } from 'firebase/auth';

function ProfileEditor({ user }: { user: User }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 保存失敗（旧実装は catch 無しで無音だった）
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaving(true); setSaveError(null);
    try {
      await updateProfile(user, { displayName });
      await setDoc(
        doc(db, `account_users/${user.uid}`),
        { displayName, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // 旧実装は catch が無く、権限/通信エラーでも「保存しました」が出ないだけの無音だった
      setSaveError(describeFirestoreError(e, '表示名の保存'));
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
        {saveError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: 0, padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{saveError}</p>}
      </div>

      {/* 通知設定への導線（Day112）。このページはどこからもリンクされておらず、
          Noxa 全サービス共通の通知 ON/OFF を変更する手段が無かった */}
      <div className="noxa-card" style={{ maxWidth: 640, marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'var(--noxa-text-primary)', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>通知設定</div>
          <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12 }}>誕生日・次回アクション・ご無沙汰・日次サマリの受け取りを切り替えます</div>
        </div>
        <Link href="/account/notifications" className="noxa-btn noxa-btn-secondary" style={{ padding: '10px 16px', fontSize: 13 }}>開く →</Link>
      </div>

      <div className="noxa-card" style={{ maxWidth: 640, marginTop: 20 }}>
        <ProModeSwitcher />
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
