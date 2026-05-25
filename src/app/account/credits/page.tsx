'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

interface LedgerEntry {
  id: string;
  amount: number;
  service?: string;
  feature?: string;
  consumedAt?: { seconds: number };
}

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
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/account" className="mb-6 inline-block text-sm text-zinc-400 hover:text-zinc-200">← NOXA Account</Link>
      <h1 className="mb-2 text-2xl font-bold">AI クレジット履歴</h1>
      <p className="mb-8 text-sm text-zinc-400">NOXA 全サービスでのクレジット消費履歴</p>

      {!loaded && <div className="text-sm text-zinc-500">読み込み中…</div>}
      {loaded && entries.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-10 text-center text-sm text-zinc-500">
          まだ利用履歴がありません
        </div>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <div className="text-sm font-medium">{e.feature ?? 'AI 機能'}</div>
                <div className="text-xs text-zinc-500">
                  {e.service ?? 'NOXA'}
                  {e.consumedAt && ` · ${new Date(e.consumedAt.seconds * 1000).toLocaleString('ja-JP')}`}
                </div>
              </div>
              <div className={`text-sm font-bold ${e.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {e.amount > 0 ? '+' : ''}{e.amount}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function CreditsPage() {
  return <AuthGuard>{(user) => <CreditsView user={user} />}</AuthGuard>;
}
