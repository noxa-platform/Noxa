/**
 * Noxa — グローバル loading skeleton
 * ui-ux-pro-max: 300ms 超え operations は skeleton を表示。
 * prefers-reduced-motion は globals.css のガードで自動対応。
 */
export default function GlobalLoading() {
  return (
    <main
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
      style={{
        minHeight: '100dvh',
        background: 'var(--noxa-bg-base)',
        color: 'var(--noxa-text-primary)',
        padding: '64px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        maxWidth: 880,
        margin: '0 auto',
      }}
    >
      <div className="noxa-eyebrow" aria-hidden>
        Loading…
      </div>
      <div style={skeletonBlock(40, '70%')} aria-hidden />
      <div style={skeletonBlock(24, '90%')} aria-hidden />
      <div style={skeletonBlock(24, '85%')} aria-hidden />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 16 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            aria-hidden
            style={{
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 'var(--noxa-radius-lg)',
              padding: 22,
              minHeight: 180,
              opacity: 0.55,
              animation: 'noxa-skel 1.4s ease-in-out infinite',
            }}
          />
        ))}
      </div>
      <span style={{ position: 'absolute', left: '-9999px' }}>読み込み中です</span>
      <style>{`
        @keyframes noxa-skel {
          0%, 100% { opacity: 0.45; }
          50%      { opacity: 0.75; }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-hidden] { animation: none !important; }
        }
      `}</style>
    </main>
  );
}

function skeletonBlock(height: number, width: string) {
  return {
    height,
    width,
    background: 'linear-gradient(90deg, var(--noxa-surface-card) 0%, var(--noxa-surface-muted) 50%, var(--noxa-surface-card) 100%)',
    borderRadius: 'var(--noxa-radius-md)',
    animation: 'noxa-skel 1.4s ease-in-out infinite',
  } as const;
}
