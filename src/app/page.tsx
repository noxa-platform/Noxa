import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Noxa — 夜の街の OS',
  description:
    'Noxa はナイトワーク総合プラットフォーム。POS / 売上管理 / 席回し / 勤怠 / 給与 / 初回案内 / 送迎 / 在庫 / 名刺発注を 1 アカウントで束ねる OS。サブ機能に夜職紹介制コミュニティとバー紹介・求人「のみシュギ」。',
};

type ModuleStatus = 'live' | 'beta' | 'soon' | 'planned';

type OsModule = {
  number?: number;             // ① 〜 ⑨
  letter?: string;             // A / B (sub-modules)
  id: string;
  title: string;
  desc: string;
  href: string;
  external?: boolean;
  status: ModuleStatus;
  group: 'main' | 'sub';
};

const MODULES: OsModule[] = [
  // MAIN ① 〜 ⑨
  {
    number: 1, id: 'pos', title: 'POS', desc: '注文 → 伝票出力に特化。決済は既存レジ運用と並走。',
    href: '/pos', status: 'live', group: 'main',
  },
  {
    number: 2, id: 'sales', title: '売上管理', desc: '個人キャストも店舗も。今夜の数字を一目で。',
    href: '/sales', status: 'live', group: 'main',
  },
  {
    number: 3, id: 'seating', title: '席回し', desc: '卓状況とキャストローテをタッチ操作で。',
    href: '/seating', status: 'live', group: 'main',
  },
  {
    number: 4, id: 'attendance', title: '勤怠管理', desc: '出勤打刻 / シフト / 遅刻 / 無断欠勤。',
    href: '/attendance', status: 'live', group: 'main',
  },
  {
    number: 5, id: 'payroll', title: '給与計算', desc: '歩合 + 時給 + バック + 罰金を月締めで自動。',
    href: '/payroll', status: 'live', group: 'main',
  },
  {
    number: 6, id: 'first-visit', title: '初回案内', desc: '新人 OJT と新規客の初回接客フロー。',
    href: '/first-visit', status: 'live', group: 'main',
  },
  {
    number: 7, id: 'transport', title: '送迎', desc: 'ドライバー配車・ピックアップ・帰宅送迎。',
    href: '/transport', status: 'live', group: 'main',
  },
  {
    number: 8, id: 'inventory', title: '在庫管理', desc: 'ボトル・食材・消耗品。POS と自動連携。',
    href: '/inventory', status: 'live', group: 'main',
  },
  {
    number: 9, id: 'business-card', title: 'オリシャン名刺発注', desc: 'デザイン → 印刷 → 発送をワンストップ。',
    href: '/business-card', status: 'live', group: 'main',
  },
  // SUB A / B
  {
    letter: 'A', id: 'community', title: '夜職コミュニティ', desc: '紹介制クローズド SNS。情報共有と相互サポート。',
    href: '/community', status: 'soon', group: 'sub',
  },
  {
    letter: 'B', id: 'nomishugy', title: 'のみシュギ',
    desc: 'バー紹介・求人・コラム。Phase v1.3 で Noxa /bars にも内蔵予定（独立ドメインと並走）。',
    href: 'https://nomishugy.vercel.app', external: true, status: 'beta', group: 'sub',
  },
];

const STATUS_META: Record<ModuleStatus, { label: string; cls: string; }> = {
  live:    { label: 'LIVE',    cls: 'noxa-status-success' },
  beta:    { label: 'BETA',    cls: 'noxa-status-success' },
  soon:    { label: 'SOON',    cls: 'noxa-status-soon' },
  planned: { label: 'PLANNED', cls: 'noxa-status-warning' },
};

export default function NoxaOsLandingPage() {
  const main = MODULES.filter((m) => m.group === 'main');
  const sub = MODULES.filter((m) => m.group === 'sub');

  return (
    <div className="relative overflow-hidden" style={{ background: 'var(--noxa-bg-base)', minHeight: '100dvh' }}>
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)',
          width: 900, height: 600,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.22) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', top: '40%', right: '-10%',
          width: 500, height: 500,
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.14) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Nav */}
      <nav
        className="relative flex items-center px-6 md:px-16 py-6"
        style={{ borderBottom: '1px solid var(--noxa-divider)' }}
      >
        <Link href="/" className="noxa-logo" style={{ fontSize: 26 }} aria-label="Noxa ホーム">
          N<em>o</em>xa
        </Link>
        <div className="hidden md:flex gap-7 ml-14 flex-1">
          <a href="#main" style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>機能</a>
          <a href="#sub" style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>サブ機能</a>
          <a href="#stack" style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>技術</a>
        </div>
        <div className="flex gap-3 items-center ml-auto">
          <Link
            href="/account/login"
            style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}
            className="hidden sm:inline"
          >
            ログイン
          </Link>
          <Link href="/account/signup" className="noxa-btn noxa-btn-primary" style={{ fontSize: 13 }}>
            はじめる
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-6 md:px-16 pt-20 md:pt-24 pb-12" style={{ maxWidth: 1200 }}>
        <div className="noxa-eyebrow">Noxa OS · NIGHT WORK PLATFORM · v1.1</div>
        <h1
          className="noxa-display"
          style={{
            fontSize: 'clamp(40px, 8vw, 96px)',
            margin: '20px 0 12px',
            color: 'var(--noxa-text-primary)',
            lineHeight: 1.02,
          }}
        >
          夜の街の{' '}
          <em
            style={{
              color: 'var(--noxa-accent-primary-ink)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontFamily: 'var(--noxa-font-display-en)',
            }}
          >
            OS
          </em>
          .
        </h1>
        <p
          style={{
            fontFamily: 'var(--noxa-font-display-jp)',
            fontSize: 'clamp(18px, 3vw, 28px)',
            color: 'var(--noxa-text-primary)',
            fontWeight: 400,
            lineHeight: 1.4,
            marginBottom: 28,
            letterSpacing: '0.04em',
            maxWidth: 820,
          }}
        >
          POS、売上管理、席回し、勤怠、給与、初回案内、送迎、在庫、名刺発注 ——
          <br />
          <span style={{ color: 'var(--noxa-text-muted)' }}>
            ナイトワークに必要なすべてを、ひとつのアカウントから。
          </span>
        </p>
        <div className="flex gap-3 flex-wrap">
          <Link href="/account/signup" className="noxa-btn noxa-btn-primary" style={{ padding: '16px 28px', fontSize: 15 }}>
            アカウントを作成
          </Link>
          <a href="#main" className="noxa-btn noxa-btn-secondary" style={{ padding: '16px 28px', fontSize: 15 }}>
            機能を見る ↓
          </a>
        </div>
      </section>

      {/* MAIN MODULES grid */}
      <section id="main" className="relative px-6 md:px-16 py-12">
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div className="noxa-eyebrow" style={{ marginBottom: 12 }}>
            9 MAIN MODULES · 店舗運営の本体
          </div>
          <h2
            style={{
              fontFamily: 'var(--noxa-font-display-jp)',
              fontSize: 'clamp(24px, 4vw, 36px)',
              color: 'var(--noxa-text-primary)',
              fontWeight: 500,
              margin: '0 0 32px',
              letterSpacing: '0.02em',
            }}
          >
            業務モジュール
          </h2>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}
          >
            {main.map((m) => (
              <ModuleCard key={m.id} module={m} />
            ))}
          </div>
        </div>
      </section>

      {/* SUB MODULES */}
      <section id="sub" className="relative px-6 md:px-16 py-12">
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div className="noxa-eyebrow" style={{ marginBottom: 12 }}>
            SUB MODULES · Noxa 上のアプリ
          </div>
          <h2
            style={{
              fontFamily: 'var(--noxa-font-display-jp)',
              fontSize: 'clamp(22px, 3.5vw, 32px)',
              color: 'var(--noxa-text-primary)',
              fontWeight: 500,
              margin: '0 0 28px',
              letterSpacing: '0.02em',
            }}
          >
            ユーザー接点のサブ機能
          </h2>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            {sub.map((m) => (
              <ModuleCard key={m.id} module={m} large />
            ))}
          </div>
        </div>
      </section>

      {/* Foundation strip */}
      <section id="stack" className="relative px-6 md:px-16 py-12">
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div className="noxa-eyebrow" style={{ marginBottom: 12 }}>
            FOUNDATION · 共通基盤
          </div>
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              padding: 24,
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 'var(--noxa-radius-lg)',
            }}
          >
            <Foundation label="DATA" head="Firebase noxa-platform" sub="Auth · Firestore · Storage" />
            <Foundation label="FRONTEND" head="Next.js 16 / React 19" sub="Tailwind 4 + shadcn/ui" />
            <Foundation label="DEPLOY" head="Vercel · Rolling" sub="noxa-delta · yorulog · nomishugy" />
            <Foundation label="MOBILE" head="Android · Capacitor" sub="iOS · SwiftUI（別リポ）" />
            <Foundation label="DESIGN" head="v1.1 Tactile Glow" sub="violet + cyan-mist / WCAG AA" />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative px-6 md:px-16 py-16">
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: 'clamp(28px, 5vw, 56px)',
            background: 'linear-gradient(135deg, #1A1228 0%, #221830 100%)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            flexWrap: 'wrap',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--noxa-glow-soft)',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              right: -100,
              top: -100,
              width: 400,
              height: 400,
              background: 'radial-gradient(circle, rgba(192,132,252,0.28) 0%, transparent 60%)',
            }}
          />
          <div className="flex-1 relative" style={{ minWidth: 280 }}>
            <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>
              Get started
            </div>
            <div
              className="noxa-display"
              style={{ fontSize: 'clamp(28px, 4vw, 40px)', marginBottom: 8 }}
            >
              あなたの夜を、<em style={{ color: 'var(--noxa-accent-primary-ink)', fontStyle: 'italic' }}>OS</em> で整える。
            </div>
            <div style={{ color: 'var(--noxa-text-muted)', fontSize: 14 }}>
              30 秒でアカウント作成。クレジットカード不要。
            </div>
          </div>
          <Link
            href="/account/signup"
            className="noxa-btn noxa-btn-primary relative"
            style={{ padding: '16px 32px', fontSize: 15 }}
          >
            はじめる →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="relative px-6 md:px-16 py-8 flex gap-4 flex-wrap items-center"
        style={{
          color: 'var(--noxa-text-faint)',
          fontSize: 12,
          borderTop: '1px solid var(--noxa-divider)',
        }}
      >
        <span>© 2026 Noxa</span>
        <span aria-hidden>·</span>
        <Link href="/terms" style={{ color: 'var(--noxa-text-faint)' }}>利用規約</Link>
        <span aria-hidden>·</span>
        <Link href="/privacy" style={{ color: 'var(--noxa-text-faint)' }}>プライバシー</Link>
        <span style={{ marginLeft: 'auto' }}>運営: egshugy / 株式会社えぐしゅぎ（法人準備中）</span>
      </footer>
    </div>
  );
}

function ModuleCard({ module, large = false }: { module: OsModule; large?: boolean }) {
  const meta = STATUS_META[module.status];
  const numLabel = module.number ? `№ ${String(module.number).padStart(2, '0')}` : `№ ${module.letter}`;
  return (
    <Link
      href={module.href}
      target={module.external ? '_blank' : undefined}
      rel={module.external ? 'noopener noreferrer' : undefined}
      className="relative overflow-hidden flex flex-col gap-3"
      style={{
        background: 'linear-gradient(180deg, #1A1228 0%, #110A1C 100%)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 'var(--noxa-radius-lg)',
        padding: large ? 28 : 22,
        minHeight: large ? 220 : 180,
        textDecoration: 'none',
        transition:
          'border-color var(--noxa-duration-fast) var(--noxa-ease-natural), box-shadow var(--noxa-duration-fast) var(--noxa-ease-natural), transform var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}
    >
      {/* top accent */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 2,
          width: 56,
          background:
            module.group === 'sub'
              ? module.id === 'community'
                ? 'var(--noxa-tint-community)'
                : 'var(--noxa-tint-nomishugy)'
              : 'var(--noxa-accent-primary)',
        }}
      />

      <div className="flex items-center justify-between">
        <span
          className="noxa-mono"
          style={{
            fontSize: 10,
            color: 'var(--noxa-text-faint)',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          {numLabel} · {module.id}
        </span>
        <span className={`noxa-status ${meta.cls}`} aria-label={`ステータス: ${meta.label}`}>
          {meta.label}
        </span>
      </div>

      <h3
        style={{
          fontFamily: 'var(--noxa-font-display-jp)',
          fontSize: large ? 24 : 20,
          color: 'var(--noxa-text-primary)',
          lineHeight: 1.25,
          fontWeight: 500,
          margin: 0,
        }}
      >
        {module.title}
      </h3>
      <p
        style={{
          color: 'var(--noxa-text-muted)',
          fontSize: 13,
          lineHeight: 1.7,
          flex: 1,
          margin: 0,
          fontFamily: 'var(--noxa-font-sans-jp)',
        }}
      >
        {module.desc}
      </p>
      <div
        className="noxa-mono"
        style={{
          color: 'var(--noxa-accent-primary-ink)',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.06em',
        }}
      >
        {module.status === 'live' || module.status === 'beta' ? 'open →' : 'preview →'}
      </div>
    </Link>
  );
}

function Foundation({ label, head, sub }: { label: string; head: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="noxa-mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--noxa-accent-primary-ink)' }}>
        {label}
      </span>
      <span style={{ color: 'var(--noxa-text-primary)', fontSize: 13, fontWeight: 600 }}>{head}</span>
      <span style={{ color: 'var(--noxa-text-muted)', fontSize: 11, fontFamily: 'var(--noxa-font-mono)' }}>{sub}</span>
    </div>
  );
}
