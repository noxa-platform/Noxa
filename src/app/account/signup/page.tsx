'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signupWithEmail, signinWithGoogle, handlePostLoginRedirect } from '@/lib/auth';

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreedToTerms) {
      setError('利用規約とプライバシーポリシーに同意してください');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signupWithEmail(email, password, displayName);
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseSignupError(err));
      setLoading(false);
    }
  }

  async function googleSignup() {
    if (!agreedToTerms) {
      setError('利用規約とプライバシーポリシーに同意してください');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signinWithGoogle();
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseSignupError(err));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/" className="mb-8 inline-block text-3xl font-black tracking-tight">NOXA</Link>
      <h1 className="mb-2 text-2xl font-bold">アカウント作成</h1>
      <p className="mb-8 text-sm text-zinc-400">
        1 つの NOXA アカウントで yorulog / nomishugy / NOXA コミュニティが使えます
      </p>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="text"
          placeholder="表示名 (任意)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />
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
          placeholder="パスワード (8文字以上)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />
        <label className="flex items-start gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <Link href="/terms" className="text-violet-400 hover:underline">利用規約</Link>
            と
            <Link href="/privacy" className="text-violet-400 hover:underline">プライバシーポリシー</Link>
            に同意します
          </span>
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? '作成中…' : 'アカウントを作成'}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />
        <span>または</span>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <button
        onClick={googleSignup}
        disabled={loading}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium transition hover:border-zinc-500 disabled:opacity-50"
      >
        Google で作成
      </button>

      <p className="mt-6 text-center text-sm text-zinc-400">
        既にアカウントをお持ちの方は{' '}
        <Link href={`/account/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-violet-400 hover:underline">
          ログイン
        </Link>
      </p>
    </main>
  );
}

function parseFirebaseSignupError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'auth/email-already-in-use') return 'このメールアドレスは既に登録されています';
  if (code === 'auth/invalid-email') return 'メールアドレスの形式が正しくありません';
  if (code === 'auth/weak-password') return 'パスワードが弱すぎます (8文字以上)';
  if (code === 'auth/network-request-failed') return 'ネットワークエラー';
  return 'アカウント作成に失敗しました';
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
