'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { User } from 'firebase/auth';
import { signOut } from '@/lib/auth';

const NAV_ACCOUNT: { label: string; href: string; icon: string }[] = [
  { label: 'ダッシュボード', href: '/account',              icon: '◇' },
  { label: 'プロフィール',   href: '/account/profile',      icon: '◇' },
  { label: '通知設定',       href: '/account/notifications', icon: '◇' },
  { label: 'プラン',         href: '/account/subscription', icon: '◈' },
  { label: 'クレジット',     href: '/account/credits',      icon: '◆' },
  { label: '退会',           href: '/account/delete',       icon: '◇' },
];

// 夜の街の OS — 業務モジュール（ガワ実装。OS のメインアプリ群）
const NAV_MODULES: { label: string; href: string; no: string }[] = [
  { label: 'POS',       href: '/pos',           no: '01' },
  { label: '席回し',    href: '/seating',       no: '03' },
  { label: '勤怠',      href: '/attendance',    no: '04' },
  { label: '給与',      href: '/payroll',       no: '05' },
  { label: '初回案内',  href: '/first-visit',   no: '06' },
  { label: '送迎',      href: '/transport',     no: '07' },
  { label: '在庫',      href: '/inventory',     no: '08' },
  { label: '名刺発注',  href: '/business-card', no: '09' },
];

const NAV_SERVICES: { label: string; href: string; tint: string; soon?: boolean }[] = [
  { label: 'community', href: '/community',                   tint: '#C4384A', soon: true },
  { label: 'nomishugy', href: 'https://nomishugy.vercel.app', tint: '#B89CFB' },
];

export function AccountShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--noxa-bg-base)' }}>
      {/* Sidebar (desktop) */}
      <aside
        className="hidden md:flex flex-col"
        style={{
          width: 240,
          background: 'var(--noxa-bg-base)',
          borderRight: '1px solid var(--noxa-border)',
          padding: '24px 16px',
          gap: 28,
        }}
      >
        <Link href="/" className="noxa-logo px-2" style={{ fontSize: 22 }}>
          N<em>o</em>xa
        </Link>

        <div className="flex flex-col" style={{ gap: 2 }}>
          <div
            className="noxa-mono px-2.5 pb-2"
            style={{
              fontSize: 10,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Account
          </div>
          {NAV_ACCOUNT.map((it) => {
            const active = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: active ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                  color: active ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)',
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  textDecoration: 'none',
                }}
              >
                <span style={{ width: 14, color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)' }}>
                  {it.icon}
                </span>
                <span>{it.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col" style={{ gap: 2 }}>
          <div
            className="noxa-mono px-2.5 pb-2"
            style={{
              fontSize: 10,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            業務モジュール
          </div>
          {NAV_MODULES.map((it) => {
            const active = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: active ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                  color: active ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)',
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  textDecoration: 'none',
                }}
              >
                <span
                  className="noxa-mono"
                  style={{
                    width: 18,
                    fontSize: 10,
                    color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)',
                  }}
                >
                  {it.no}
                </span>
                <span>{it.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col" style={{ gap: 2 }}>
          <div
            className="noxa-mono px-2.5 pb-2"
            style={{
              fontSize: 10,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Services
          </div>
          {NAV_SERVICES.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              target={s.href.startsWith('http') ? '_blank' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                color: s.soon ? 'var(--noxa-text-faint)' : 'var(--noxa-text-primary)',
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6, height: 6, borderRadius: 3,
                  background: s.tint,
                  opacity: s.soon ? 0.5 : 1,
                }}
              />
              <span className="noxa-mono" style={{ fontSize: 13 }}>{s.label}</span>
              {s.soon && (
                <span
                  className="noxa-mono"
                  style={{
                    marginLeft: 'auto', fontSize: 9,
                    color: 'var(--noxa-text-faint)',
                  }}
                >
                  SOON
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* User card */}
        <div
          className="mt-auto flex items-center gap-2.5"
          style={{
            padding: 10,
            borderRadius: 10,
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
          }}
        >
          <div
            style={{
              width: 32, height: 32, borderRadius: 16,
              background: 'linear-gradient(135deg, #8B5CF6 0%, #C4384A 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              fontFamily: 'var(--noxa-font-display-en)',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {(user.displayName ?? user.email ?? 'N')[0].toUpperCase()}
          </div>
          <div className="min-w-0" style={{ flex: 1 }}>
            <div
              style={{
                color: 'var(--noxa-text-primary)',
                fontSize: 12,
                fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {user.displayName ?? 'Noxa ユーザー'}
            </div>
            <div
              style={{
                color: 'var(--noxa-text-muted)',
                fontSize: 10,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {user.email}
            </div>
          </div>
          <button
            onClick={async () => { await signOut(); window.location.href = '/'; }}
            className="noxa-btn noxa-btn-ghost"
            style={{ padding: '6px 8px', fontSize: 11 }}
            title="ログアウト"
          >
            ↗
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3"
        style={{
          background: 'var(--noxa-bg-overlay)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--noxa-border)',
        }}
      >
        <Link href="/" className="noxa-logo" style={{ fontSize: 18 }}>
          N<em>o</em>xa
        </Link>
        <button
          onClick={async () => { await signOut(); window.location.href = '/'; }}
          style={{ color: 'var(--noxa-text-muted)', fontSize: 12, background: 'transparent', border: 'none' }}
        >
          ログアウト
        </button>
      </header>

      {/* Main */}
      <main
        className="flex-1 overflow-auto pt-16 md:pt-0"
        style={{ padding: '36px 40px' }}
      >
        {children}
      </main>
    </div>
  );
}
