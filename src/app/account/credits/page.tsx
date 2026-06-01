'use client';
import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

interface LedgerEntry {
  id: string;
  amount: number;
  service?: string;
  feature?: string;
  consumedAt?: { seconds: number };
}

const SERVICE_TINT: Record<string, string> = {
  yorulog: '#8B5CF6',
  nomishugy: '#B89CFB',
  community: '#C4384A',
};

function CreditsView({ user }: { user: User }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const q = query(
        collection(db, `account_credit_ledger/${user.uid}/entries`),
        orderBy('consumedAt', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry)));
      setLoaded(true);
    })();
  }, [user.uid]);

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Account · Credits</div>
      <h1 className="noxa-h1" style={{ margin: '0 0 8px' }}>AI クレジット履歴</h1>
      <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, marginBottom: 32 }}>
        Noxa 全サービスでのクレジット消費履歴
      </p>

      {!loaded && <div className="noxa-caption">読み込み中…</div>}

      {loaded && entries.length === 0 && (
        <div
          className="noxa-card"
          style={{ padding: 40, textAlign: 'center', color: 'var(--noxa-text-muted)', fontSize: 14, maxWidth: 720 }}
        >
          まだ利用履歴がありません
        </div>
      )}

      {entries.length > 0 && (
        <div
          className="noxa-card"
          style={{ padding: 0, overflow: 'hidden', maxWidth: 720 }}
        >
          {entries.map((e, i) => {
            const tint = e.service ? SERVICE_TINT[e.service] ?? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)';
            return (
              <div
                key={e.id}
                className="flex items-center justify-between"
                style={{
                  padding: '14px 22px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--noxa-divider)',
                }}
              >
                <div>
                  <div style={{ color: 'var(--noxa-text-primary)', fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                    {e.feature ?? 'AI 機能'}
                  </div>
                  <div
                    className="noxa-mono"
                    style={{ color: 'var(--noxa-text-muted)', fontSize: 11 }}
                  >
                    <span style={{ color: tint }}>●</span> {e.service ?? 'Noxa'}
                    {e.consumedAt && ` · ${new Date(e.consumedAt.seconds * 1000).toLocaleString('ja-JP')}`}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--noxa-font-display-en)',
                    fontSize: 18,
                    fontWeight: 500,
                    color: e.amount < 0 ? 'var(--noxa-accent-destructive)' : '#7BE8A1',
                  }}
                >
                  {e.amount > 0 ? '+' : ''}{e.amount}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AccountShell>
  );
}

export default function CreditsPage() {
  return <AuthGuard>{(user) => <CreditsView user={user} />}</AuthGuard>;
}
