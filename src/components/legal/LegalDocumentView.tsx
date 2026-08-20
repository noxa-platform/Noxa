import Link from 'next/link';
import type { LegalDocument } from '@/lib/legal/documents';

/**
 * 法務文書の共通レイアウト（サーバコンポーネント・認証不要）。
 *
 * App Store / Google Play の審査と、未ログインの利用者が読む前提なので
 * **認証を挟まない静的ページ**にする（ログインの向こう側に置くと審査で 404 と同じ扱いになる）。
 */
export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <main
      style={{
        maxWidth: 760, margin: '0 auto', padding: 'clamp(24px, 5vw, 56px) 20px 64px',
        color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)',
      }}
    >
      <nav aria-label="breadcrumb" style={{ marginBottom: 18 }}>
        <Link href="/" style={{ color: 'var(--noxa-text-muted)', fontSize: 12, textDecoration: 'none' }}>← Noxa</Link>
      </nav>

      <h1 className="noxa-display" style={{ fontSize: 'clamp(22px, 4vw, 30px)', margin: '0 0 6px', fontWeight: 500 }}>
        {doc.title}
      </h1>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--noxa-text-faint)' }}>
        最終更新日: {doc.updatedAt}
      </p>
      <p style={{ margin: '0 0 32px', fontSize: 13, color: 'var(--noxa-text-muted)', lineHeight: 1.9 }}>
        {doc.lead}
      </p>

      {doc.sections.map((s) => (
        <section key={s.title} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>{s.title}</h2>
          {/* 原文の改行をそのまま出す（法務文書は整形で意味が変わる） */}
          <p style={{ margin: 0, fontSize: 14, lineHeight: 2, whiteSpace: 'pre-wrap', color: 'var(--noxa-text-primary)' }}>
            {s.body}
          </p>
        </section>
      ))}

      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--noxa-divider)', fontSize: 12, color: 'var(--noxa-text-faint)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>© 2026 Noxa</span>
        <span aria-hidden>·</span>
        <Link href="/terms" style={{ color: 'var(--noxa-text-faint)' }}>利用規約</Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" style={{ color: 'var(--noxa-text-faint)' }}>プライバシーポリシー</Link>
      </footer>
    </main>
  );
}
