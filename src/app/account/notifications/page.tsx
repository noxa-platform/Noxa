'use client';
import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
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
    await setDoc(
      doc(db, `account_app_settings/${user.uid}`),
      { id: user.uid, notificationPrefs: prefs, updatedAt: serverTimestamp() },
      { merge: true },
    );
    setSaving(false);
  }

  const items: { key: keyof typeof DEFAULTS; label: string; desc: string }[] = [
    { key: 'birthday', label: '誕生日通知', desc: '顧客の誕生日リマインド (yorulog)' },
    { key: 'nextAction', label: '次回アクション通知', desc: '期日のリマインド (yorulog)' },
    { key: 'longTimeNoSee', label: 'ご無沙汰通知', desc: '長期間連絡のない顧客の通知' },
    { key: 'dailySummary', label: '日次サマリ', desc: '前日の売上 / 接触ログのまとめ' },
  ];

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Account · Notifications</div>
      <h1 className="noxa-h1" style={{ margin: '0 0 8px' }}>通知設定</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, marginBottom: 32 }}>
        Noxa 全サービス共通の通知設定です
      </p>

      {!loaded ? (
        <div className="noxa-caption">読み込み中…</div>
      ) : (
        <div className="noxa-card" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item, i) => (
            <div key={item.key}>
              {i > 0 && <div className="noxa-hairline" style={{ margin: '6px 0' }} />}
              <label className="flex items-start justify-between gap-4" style={{ padding: '8px 0', cursor: 'pointer' }}>
                <div>
                  <div style={{ color: 'var(--noxa-text-primary)', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                    {item.label}
                  </div>
                  <div style={{ color: 'var(--noxa-text-muted)', fontSize: 12 }}>{item.desc}</div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs[item.key]}
                  onChange={(e) => setPrefs({ ...prefs, [item.key]: e.target.checked })}
                  style={{ width: 18, height: 18, marginTop: 4, accentColor: 'var(--noxa-accent-primary)' }}
                />
              </label>
            </div>
          ))}
          <button
            onClick={save}
            disabled={saving}
            className="noxa-btn noxa-btn-primary"
            style={{ padding: '12px 24px', fontSize: 14, alignSelf: 'flex-start', marginTop: 12 }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      )}
    </AccountShell>
  );
}

export default function NotificationsPage() {
  return <AuthGuard>{(user) => <NotificationsEditor user={user} />}</AuthGuard>;
}
