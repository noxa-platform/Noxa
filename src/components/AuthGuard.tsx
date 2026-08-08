'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { buildLoginRedirectUrl } from '@/lib/auth';

export function AuthGuard({ children }: { children: (user: User) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        // クエリごと戻り先にする（招待リンク /store/join?shop=&code= やコミュニティの
        // ?invite=CODE は、クエリが落ちるとログイン後に行き止まりになる）
        const redirect = encodeURIComponent(
          buildLoginRedirectUrl({ origin: window.location.origin, pathname, search: window.location.search }),
        );
        router.replace(`/account/login?redirect=${redirect}`);
        return;
      }
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, [router, pathname]);

  if (loading || !user) {
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--noxa-bg-base)' }}
      >
        <div className="noxa-eyebrow">読み込み中…</div>
      </main>
    );
  }
  return <>{children(user)}</>;
}
