'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginWithEmail, signinWithGoogle, handlePostLoginRedirect } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginWithEmail(email, password);
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseAuthError(err));
      setLoading(false);
    }
  }

  async function googleLogin() {
    setLoading(true);
    setError(null);
    try {
      await signinWithGoogle();
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseAuthError(err));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/" className="mb-8 inline-block text-3xl font-black tracking-tight">NOXA</Link>
      <h1 className="mb-2 text-2xl font-bold">ログイン</h1>
      <p className="mb-8 text-sm text-zinc-400">
        NOXA アカウントでログイン
        {redirect && <span className="ml-1">（ログイン後 {new URL(redirect).hostname} に戻ります）</span>}
      </p>

      <button
        onClick={googleLogin}
        disabled={loading}
        className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium transition hover:border-zinc-500 disabled:opacity-50"
      >
        Google でログイン
      </button>

      <div className="mb-4 flex items-center gap-3 text-xs text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />
        <span>または</span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />
        <input
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        アカウントをお持ちでない方は{' '}
        <Link href={`/account/signup${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-violet-400 hover:underline">
          新規作成
        </Link>
      </p>
    </main>
  );
}

function parseFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'メールアドレスまたはパスワードが間違っています';
  }
  if (code === 'auth/too-many-requests') return 'ログイン試行が多すぎます。しばらく待ってから再試行してください';
  if (code === 'auth/network-request-failed') return 'ネットワークエラー';
  return 'ログインに失敗しました';
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
