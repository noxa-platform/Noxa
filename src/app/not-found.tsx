import Link from 'next/link';

/**
 * Noxa — 404
 * ui-ux-pro-max: empty-nav-state（理由 + 経路）
 */
export default function NotFound() {
  return (
    <main
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
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 700,
          height: 500,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.16) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div className="noxa-eyebrow" style={{ position: 'relative' }}>404 · Not Found</div>
      <h1
        className="noxa-display"
        style={{ fontSize: 'clamp(48px, 9vw, 88px)', margin: 0, position: 'relative' }}
      >
        404
      </h1>
      <p
        style={{
          fontFamily: 'var(--noxa-font-display-jp)',
          fontSize: 'clamp(18px, 3vw, 24px)',
          color: 'var(--noxa-text-primary)',
          margin: 0,
          letterSpacing: '0.02em',
          position: 'relative',
        }}
      >
        この夜は、<span style={{ color: 'var(--noxa-accent-primary-ink)' }}>見つかりません</span>でした。
      </p>
      <p
        style={{
          color: 'var(--noxa-text-muted)',
          maxWidth: 520,
          lineHeight: 1.65,
          fontSize: 14,
          margin: 0,
          position: 'relative',
        }}
      >
        お探しのページは移動した、または存在しません。
      </p>
      <div className="flex gap-3 flex-wrap" style={{ marginTop: 12, position: 'relative' }}>
        <Link
          href="/"
          className="noxa-btn noxa-btn-primary"
          style={{ padding: '14px 28px', fontSize: 15 }}
        >
          ホームへ戻る
        </Link>
        <Link
          href="/account"
          className="noxa-btn noxa-btn-secondary"
          style={{ padding: '14px 28px', fontSize: 15 }}
        >
          アカウント
        </Link>
      </div>
    </main>
  );
}
