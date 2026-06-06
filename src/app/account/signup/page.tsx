'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signupWithEmail, signinWithGoogle, signinWithApple, handlePostLoginRedirect } from '@/lib/auth';
import { startLineLogin, isLineLoginEnabled } from '@/lib/auth/line';

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

  async function appleSignup() {
    setLoading(true);
    setError(null);
    try {
      await signinWithApple();
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseSignupError(err));
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex" style={{ background: 'var(--noxa-bg-base)' }}>
      {/* Visual half */}
      <div
        className="hidden lg:flex flex-1 relative overflow-hidden flex-col justify-between"
        style={{
          borderRight: '1px solid var(--noxa-border)',
          background: 'linear-gradient(160deg, #110A1C 0%, #07050D 100%)',
          padding: 48,
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute', top: '15%', left: '15%',
            width: 400, height: 400,
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.18) 0%, transparent 60%)',
          }}
        />
        <Link href="/" className="noxa-logo relative" style={{ fontSize: 30 }}>
          N<em>o</em>xa
        </Link>

        <div className="relative">
          <h2
            style={{
              fontFamily: 'var(--noxa-font-display-jp)',
              fontSize: 36,
              color: 'var(--noxa-text-primary)',
              lineHeight: 1.4,
              fontWeight: 500,
              letterSpacing: '0.02em',
              margin: 0,
            }}
          >
            あなたの夜を、
            <br />
            <span
              style={{
                color: 'var(--noxa-accent-primary-ink)',
                fontSize: 28,
                fontFamily: 'var(--noxa-font-display-en)',
                fontStyle: 'italic',
                fontWeight: 400,
                letterSpacing: 0,
              }}
            >
              integrate.
            </span>
          </h2>
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, marginTop: 18, maxWidth: 360, lineHeight: 1.65 }}>
            1 つの Noxa アカウントで yorulog / nomishugy / Noxa Community が使えます。
            30 秒で作成、クレジットカード不要。
          </p>
        </div>

        <div className="relative flex gap-4" style={{ color: 'var(--noxa-text-faint)', fontSize: 12 }}>
          <span>© 2026 Noxa</span>
          <span aria-hidden>·</span>
          <Link href="/terms" style={{ color: 'var(--noxa-text-faint)' }}>利用規約</Link>
          <span aria-hidden>·</span>
          <Link href="/privacy" style={{ color: 'var(--noxa-text-faint)' }}>プライバシー</Link>
        </div>
      </div>

      {/* Form half */}
      <div
        className="flex flex-col justify-center w-full lg:w-[460px]"
        style={{ padding: '64px 32px', gap: 24 }}
      >
        <div>
          <Link href="/" className="noxa-logo lg:hidden inline-block mb-8" style={{ fontSize: 24 }}>
            N<em>o</em>xa
          </Link>
          <div className="noxa-eyebrow" style={{ marginBottom: 14 }}>Create</div>
          <h1 className="noxa-display" style={{ fontSize: 36, marginBottom: 8 }}>
            Welcome
          </h1>
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, margin: 0 }}>
            Noxa アカウントを作成
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col" style={{ gap: 16 }}>
          <div>
            <label className="noxa-label" htmlFor="displayName">表示名（任意）</label>
            <input
              id="displayName"
              type="text"
              className="noxa-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: 凛"
            />
          </div>
          <div>
            <label className="noxa-label" htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              className="noxa-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@noxa.app"
              required
            />
          </div>
          <div>
            <label className="noxa-label" htmlFor="password">パスワード（8文字以上）</label>
            <input
              id="password"
              type="password"
              className="noxa-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              aria-invalid={!!error}
            />
          </div>
          <label className="flex items-start gap-2.5" style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <Link href="/terms" style={{ color: 'var(--noxa-accent-primary-ink)' }}>利用規約</Link>
              {' '}と{' '}
              <Link href="/privacy" style={{ color: 'var(--noxa-accent-primary-ink)' }}>プライバシーポリシー</Link>
              に同意します
            </span>
          </label>
          {error && (
            <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="noxa-btn noxa-btn-primary"
            style={{ padding: '14px', fontSize: 15, width: '100%' }}
          >
            {loading ? '作成中…' : 'アカウントを作成'}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 noxa-hairline" />
          <span
            className="noxa-mono"
            style={{ color: 'var(--noxa-text-faint)', fontSize: 11, letterSpacing: '0.1em' }}
          >
            OR
          </span>
          <div className="flex-1 noxa-hairline" />
        </div>

        <button
          type="button"
          onClick={googleSignup}
          disabled={loading}
          className="noxa-btn noxa-btn-secondary"
          style={{ padding: '12px', fontSize: 14, width: '100%' }}
        >
          <span
            style={{
              width: 18, height: 18, borderRadius: 4,
              background: '#fff', color: '#07050D',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--noxa-font-display-en)', fontSize: 13, fontWeight: 600,
            }}
          >
            G
          </span>
          Google で続ける
        </button>

        <button
          type="button"
          onClick={appleSignup}
          disabled={loading}
          className="noxa-btn noxa-btn-secondary"
          style={{ padding: '12px', fontSize: 14, width: '100%' }}
        >
          <span
            style={{
              width: 18, height: 18,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: 'var(--noxa-text-primary)',
            }}
            aria-hidden
          ></span>
          Apple で続ける
        </button>

        {isLineLoginEnabled() && (
          <button
            type="button"
            onClick={() => { setLoading(true); setError(null); startLineLogin(redirect); }}
            disabled={loading}
            className="noxa-btn"
            style={{ padding: '12px', fontSize: 14, width: '100%', background: '#06C755', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <span
              aria-hidden
              style={{
                width: 18, height: 18, borderRadius: 4,
                background: '#fff', color: '#06C755',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}
            >
              L
            </span>
            LINE で続ける
          </button>
        )}

        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--noxa-text-muted)', margin: 0 }}>
          既にアカウントをお持ちの方は{' '}
          <Link
            href={`/account/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
            style={{ color: 'var(--noxa-accent-primary-ink)' }}
          >
            ログイン
          </Link>
        </p>
      </div>
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
