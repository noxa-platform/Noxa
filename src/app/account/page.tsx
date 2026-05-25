'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { signOut } from '@/lib/auth';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

interface Sub {
  planTier: string;
  aiCreditsTotal: number;
  aiCreditsUsed?: number;
}

function AccountHub({ user }: { user: User }) {
  const [sub, setSub] = useState<Sub | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, `account_subscriptions/${user.uid}`));
      if (snap.exists()) setSub(snap.data() as Sub);
    })();
  }, [user.uid]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-2xl font-black tracking-tight">NOXA</Link>
        <button
          onClick={async () => { await signOut(); window.location.href = '/'; }}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ログアウト
        </button>
      </header>

      <section className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 flex items-center gap-4">
          {user.photoURL && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" className="size-12 rounded-full" />
          )}
          <div>
            <div className="text-lg font-bold">{user.displayName ?? 'NOXA ユーザー'}</div>
            <div className="text-xs text-zinc-500">{user.email}</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">プラン</div>
            <div className="text-xl font-bold capitalize">{sub?.planTier ?? 'free'}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">AI クレジット残高</div>
            <div className="text-xl font-bold">
              {sub ? `${(sub.aiCreditsTotal ?? 0) - (sub.aiCreditsUsed ?? 0)} / ${sub.aiCreditsTotal ?? 0}` : '–'}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">サービスを開く</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="https://yorulog.vercel.app" target="_blank" className="rounded-xl border border-zinc-800 bg-gradient-to-br from-violet-500/30 to-fuchsia-500/10 p-4 transition hover:border-zinc-600">
            <div className="font-bold">yorulog</div>
            <div className="text-xs text-zinc-400">夜職向け CRM</div>
          </Link>
          <Link href="https://nomishugy.vercel.app" target="_blank" className="rounded-xl border border-zinc-800 bg-gradient-to-br from-amber-500/30 to-rose-500/10 p-4 transition hover:border-zinc-600">
            <div className="font-bold">nomishugy</div>
            <div className="text-xs text-zinc-400">バー検索・飲み仲間・求人</div>
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-500">設定</h2>
        <nav className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          {[
            ['/account/profile', 'プロフィール'],
            ['/account/notifications', '通知設定'],
            ['/account/subscription', 'プラン・課金'],
            ['/account/credits', 'AI クレジット履歴'],
            ['/account/delete', '退会'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5 text-sm last:border-b-0 hover:bg-zinc-900">
              <span>{label}</span>
              <span className="text-zinc-500">→</span>
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}

export default function AccountPage() {
  return <AuthGuard>{(user) => <AccountHub user={user} />}</AuthGuard>;
}
