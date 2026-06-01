'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Noxa — グローバル error boundary
 * ui-ux-pro-max: error-clarity（原因 + 回復経路）+ escape-routes
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 開発時のみ console、本番は監視サービスへ送信する想定
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[Noxa] error boundary:', error);
    }
  }, [error]);

  return (
    <main
      role="alert"
      aria-live="assertive"
      style={{
        minHeight: '100dvh',
        background: 'var(--noxa-bg-base)',
        color: 'var(--noxa-text-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      <div className="noxa-eyebrow">Error · 500</div>
      <h1
        className="noxa-display"
        style={{ fontSize: 'clamp(36px, 6vw, 56px)', margin: 0 }}
      >
        夜は <em style={{ color: 'var(--noxa-accent-primary-ink)', fontStyle: 'italic' }}>静か</em> に。<br />
        <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: '0.7em' }}>
          だが、何かが詰まりました。
        </span>
      </h1>
      <p
        style={{
          color: 'var(--noxa-text-muted)',
          maxWidth: 520,
          lineHeight: 1.65,
          fontSize: 15,
          margin: 0,
        }}
      >
        サーバー側で予期せぬエラーが発生しました。
        {error.digest && (
          <>
            <br />
            <span
              className="noxa-mono"
              style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}
            >
              digest: {error.digest}
            </span>
          </>
        )}
      </p>
      <div className="flex gap-3 flex-wrap" style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => reset()}
          className="noxa-btn noxa-btn-primary"
          style={{ padding: '14px 28px', fontSize: 15 }}
        >
          もう一度試す
        </button>
        <Link
          href="/"
          className="noxa-btn noxa-btn-secondary"
          style={{ padding: '14px 28px', fontSize: 15 }}
        >
          ホームへ戻る
        </Link>
      </div>
    </main>
  );
}
