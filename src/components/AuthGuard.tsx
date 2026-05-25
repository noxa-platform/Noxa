'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';

export function AuthGuard({ children }: { children: (user: User) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        const redirect = encodeURIComponent(window.location.origin + pathname);
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
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-zinc-500">読み込み中…</div>
      </main>
    );
  }
  return <>{children(user)}</>;
}
