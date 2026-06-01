'use client';
import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { loginWithEmail, signinWithGoogle, signinWithApple, handlePostLoginRedirect } from '@/lib/auth';
import { auth } from '@/lib/firebase/config';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // 自動 redirect 実行済みフラグ — 多重発火と無限ループを防止
  const autoRedirectFiredRef = useRef(false);

  /**
   * ログイン済み + redirect query あり → 自動で yorulog 等に戻す
   *
   * 経緯: SSO ハブ化により、yorulog/login → noxa/account/login?redirect=... の
   * フローが既存実装。だがログイン済みユーザーが /account/login に到達した
   * ケース (別タブ・再アクセス等) で自動 redirect しないため、フォームが
   * 表示されたまま戻れない UX バグがあった。本 useEffect で対応する。
   */
  useEffect(() => {
    if (!redirect) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && !autoRedirectFiredRef.current) {
        autoRedirectFiredRef.current = true;
        handlePostLoginRedirect(redirect, router).catch((e) => {
          console.error('[login] auto-redirect failed', e);
          autoRedirectFiredRef.current = false;
        });
      }
    });
    return unsubscribe;
  }, [redirect, router]);

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

  async function appleLogin() {
    setLoading(true);
    setError(null);
    try {
      await signinWithApple();
      await handlePostLoginRedirect(redirect, router);
    } catch (err: unknown) {
      setError(parseFirebaseAuthError(err));
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex" style={{ background: 'var(--noxa-bg-base)' }}>
      {/* Visual half (hidden on mobile) */}
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
            position: 'absolute', top: '20%', left: '10%',
            width: 400, height: 400,
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.18) 0%, transparent 60%)',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute', bottom: '10%', right: '15%',
            width: 280, height: 280,
            background: 'radial-gradient(circle, rgba(192, 132, 252, 0.10) 0%, transparent 70%)',
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
            おかえりなさい。
            <br />
            <span
              style={{
                color: 'var(--noxa-accent-primary-ink)',
                fontSize: 22,
                fontFamily: 'var(--noxa-font-display-en)',
                fontStyle: 'italic',
                fontWeight: 400,
                letterSpacing: 0,
              }}
            >
              The night is yours, again.
            </span>
          </h2>
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, marginTop: 18, maxWidth: 360, lineHeight: 1.65 }}>
            yorulog, nomishugy, Noxa Community. ひとつの Noxa アカウントで、全てのサービスに。
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
        style={{ padding: '64px 32px', gap: 28 }}
      >
        <div>
          <Link href="/" className="noxa-logo lg:hidden inline-block mb-8" style={{ fontSize: 24 }}>
            N<em>o</em>xa
          </Link>
          <div className="noxa-eyebrow" style={{ marginBottom: 14 }}>Sign in</div>
          <h1
            className="noxa-display"
            style={{ fontSize: 36, marginBottom: 8 }}
          >
            Welcome back
          </h1>
          <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, margin: 0 }}>
            Noxa アカウントでログイン
            {redirect && (
              <>
                <br />
                <span style={{ fontSize: 12 }}>
                  (ログイン後 {safeHost(redirect)} に戻ります)
                </span>
              </>
            )}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col" style={{ gap: 16 }}>
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
            <label className="noxa-label" htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              className="noxa-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={!!error}
            />
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <Link href="/account/reset" style={{ color: 'var(--noxa-accent-primary-ink)', fontSize: 12 }}>
                パスワードを忘れた？
              </Link>
            </div>
          </div>
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
            {loading ? 'ログイン中…' : 'ログイン'}
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
          onClick={googleLogin}
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
          onClick={appleLogin}
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

        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--noxa-text-muted)', margin: 0 }}>
          アカウントをお持ちでない？{' '}
          <Link
            href={`/account/signup${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
            style={{ color: 'var(--noxa-accent-primary-ink)' }}
          >
            新規登録
          </Link>
        </p>
      </div>
    </main>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
