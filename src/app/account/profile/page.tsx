'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { AuthGuard } from '@/components/AuthGuard';
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
      await setDoc(doc(db, `account_users/${user.uid}`), {
        displayName,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/account" className="mb-6 inline-block text-sm text-zinc-400 hover:text-zinc-200">← NOXA Account</Link>
      <h1 className="mb-8 text-2xl font-bold">プロフィール</h1>

      <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div>
          <label className="mb-2 block text-xs text-zinc-400">表示名</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs text-zinc-400">メールアドレス（変更不可）</label>
          <input
            type="email"
            value={user.email ?? ''}
            disabled
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-500"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {saving ? '保存中…' : saved ? '保存しました ✓' : '保存'}
        </button>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return <AuthGuard>{(user) => <ProfileEditor user={user} />}</AuthGuard>;
}
