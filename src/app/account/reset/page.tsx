'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sendPasswordReset } from '@/lib/auth';
import { describeAuthError } from '@/lib/auth-error';

/**
 * パスワード再設定（Day112）。
 *
 * ログイン画面には前から「パスワードを忘れた？」の導線があったが、遷移先の `/account/reset` も
 * `sendPasswordResetEmail` の呼び出しも**存在しなかった**＝メール＋パスワードで登録した利用者は
 * パスワードを忘れた時点で詰んでいた（404 に着地するだけで、復旧手段が案内されない）。
 *
 * 表示の方針: **送信できたかどうかで文面を変えない**。
 * 「そのメールは登録されていません」と出すと、どのメールが Noxa に登録済みかを外部から
 * 確認できてしまう（ユーザー列挙）。在籍の露見が実害になり得る利用者がいるため、
 * 未登録でも同じ「送信しました」を出す（送信自体の失敗＝要再試行だけをエラーにする）。
 */
function ResetForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err: unknown) {
      setError(describeAuthError(err, 'reset'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="noxa-zone" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Link href="/" className="noxa-logo inline-block" style={{ fontSize: 24, marginBottom: 28 }}>
          N<em>o</em>xa
        </Link>
        <div className="noxa-eyebrow" style={{ marginBottom: 14 }}>Reset password</div>
        <h1 className="noxa-display" style={{ fontSize: 32, marginBottom: 8 }}>パスワードの再設定</h1>

        {sent ? (
          <>
            <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, lineHeight: 1.8, margin: '0 0 20px' }}>
              再設定用のメールを送信しました（登録があれば届きます）。メール内のリンクから新しいパスワードを設定してください。
              <br />
              届かない場合は迷惑メールフォルダをご確認のうえ、時間をおいてもう一度お試しください。
            </p>
            <Link href="/account/login" className="noxa-btn noxa-btn-primary" style={{ padding: '14px', fontSize: 15, width: '100%', display: 'block', textAlign: 'center' }}>
              ログインに戻る
            </Link>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--noxa-text-muted)', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' }}>
              登録したメールアドレスに、パスワード再設定用のリンクを送ります。
            </p>
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
                  aria-invalid={!!error}
                />
              </div>
              {error && (
                <p role="alert" style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, margin: 0 }}>{error}</p>
              )}
              <button type="submit" disabled={loading} className="noxa-btn noxa-btn-primary" style={{ padding: '14px', fontSize: 15, width: '100%' }}>
                {loading ? '送信中…' : '再設定メールを送る'}
              </button>
            </form>
            <p style={{ color: 'var(--noxa-text-faint)', fontSize: 12, marginTop: 20, lineHeight: 1.7 }}>
              Google / Apple / LINE でログインしている場合はパスワードがありません。
              そのままそのボタンから <Link href="/account/login" style={{ color: 'var(--noxa-accent-primary-ink)' }}>ログイン</Link> してください。
            </p>
          </>
        )}
      </div>
    </main>
  );
}

/** 再試行が要る失敗だけを文言にする（未登録は成功と同じ表示なのでここに来ない） */
export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
