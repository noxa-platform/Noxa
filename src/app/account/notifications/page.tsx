'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

const DEFAULTS = {
  birthday: true,
  nextAction: true,
  longTimeNoSee: true,
  dailySummary: false,
};

function NotificationsEditor({ user }: { user: User }) {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, `account_app_settings/${user.uid}`));
      if (snap.exists()) {
        const d = snap.data();
        setPrefs({ ...DEFAULTS, ...(d.notificationPrefs ?? {}) });
      }
      setLoaded(true);
    })();
  }, [user.uid]);

  async function save() {
    setSaving(true);
    await setDoc(doc(db, `account_app_settings/${user.uid}`), {
      id: user.uid,
      notificationPrefs: prefs,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setSaving(false);
  }

  if (!loaded) return <main className="p-10 text-sm text-zinc-500">読み込み中…</main>;

  const items: { key: keyof typeof DEFAULTS; label: string; desc: string }[] = [
    { key: 'birthday', label: '誕生日通知', desc: '顧客の誕生日リマインド (yorulog)' },
    { key: 'nextAction', label: '次回アクション通知', desc: '期日のリマインド (yorulog)' },
    { key: 'longTimeNoSee', label: 'ご無沙汰通知', desc: '長期間連絡のない顧客の通知' },
    { key: 'dailySummary', label: '日次サマリ', desc: '前日の売上 / 接触ログのまとめ' },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/account" className="mb-6 inline-block text-sm text-zinc-400 hover:text-zinc-200">← NOXA Account</Link>
      <h1 className="mb-2 text-2xl font-bold">通知設定</h1>
      <p className="mb-8 text-sm text-zinc-400">NOXA 全サービス共通の通知設定です</p>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        {items.map((item) => (
          <label key={item.key} className="flex items-start justify-between gap-4 py-3">
            <div>
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-zinc-500">{item.desc}</div>
            </div>
            <input
              type="checkbox"
              checked={prefs[item.key]}
              onChange={(e) => setPrefs({ ...prefs, [item.key]: e.target.checked })}
              className="mt-1 size-5"
            />
          </label>
        ))}
        <button
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </main>
  );
}

export default function NotificationsPage() {
  return <AuthGuard>{(user) => <NotificationsEditor user={user} />}</AuthGuard>;
}
