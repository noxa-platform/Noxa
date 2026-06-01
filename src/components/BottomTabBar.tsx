'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Noxa — モバイル Bottom Tab Bar
 *
 * 設計指針 (ui-ux-pro-max + Apple HIG + Material):
 *  - 5 個まで（Material bottom-nav-limit）
 *  - 各タブ icon + ラベル両表示
 *  - touch target 44×44px 以上
 *  - aria-current="page" で現在地表示
 *  - safe-area-inset-bottom 対応（Capacitor / iOS）
 *  - md 以上では非表示（desktop は sidebar 等で対応）
 *  - hover でなく tap 前提
 */

type Tab = {
  href: string;
  label: string;
  glyph: string;             // ◇ ◈ ◆ シンプル形状（Noxa brand 規約）
  match?: (path: string) => boolean;
};

const DEFAULT_TABS: Tab[] = [
  { href: '/',                  label: 'ホーム',   glyph: '◇', match: (p) => p === '/' },
  { href: '/account',           label: 'アカウント', glyph: '◈', match: (p) => p.startsWith('/account') },
  { href: 'https://yorulog.vercel.app',   label: 'yorulog',  glyph: '◆' },
  { href: 'https://nomishugy.vercel.app', label: 'nomishugy', glyph: '◇' },
  { href: '/community',         label: '掲示板',   glyph: '◆', match: (p) => p.startsWith('/community') },
];

export type BottomTabBarProps = {
  tabs?: Tab[];
};

export function BottomTabBar({ tabs = DEFAULT_TABS }: BottomTabBarProps) {
  const path = usePathname();
  const active = (t: Tab) => (t.match ? t.match(path) : path === t.href);

  return (
    <nav
      role="navigation"
      aria-label="モバイル メイン ナビゲーション"
      className="fixed bottom-0 left-0 right-0 md:hidden"
      style={{
        background: 'var(--noxa-bg-elevated)',
        borderTop: '1px solid var(--noxa-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        zIndex: 50,
      }}
    >
      <ul
        className="flex"
        style={{ margin: 0, padding: 0, listStyle: 'none' }}
      >
        {tabs.map((t) => {
          const isActive = active(t);
          const external = t.href.startsWith('http');
          const inner = (
            <span
              className="flex flex-col items-center justify-center"
              style={{
                minHeight: 56,
                gap: 2,
                color: isActive ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)',
                fontFamily: 'var(--noxa-font-mono)',
                fontSize: 10,
                letterSpacing: '0.04em',
                padding: '8px 4px',
                width: '100%',
                transition: 'color var(--noxa-duration-fast) var(--noxa-ease-natural)',
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 18,
                  lineHeight: 1,
                  textShadow: isActive ? '0 0 12px rgba(184, 156, 251, 0.6)' : 'none',
                }}
              >
                {t.glyph}
              </span>
              <span style={{ marginTop: 2 }}>{t.label}</span>
            </span>
          );
          return (
            <li key={t.href} style={{ flex: 1, minWidth: 0 }}>
              <Link
                href={t.href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                aria-current={isActive ? 'page' : undefined}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noxa-accent-primary-ink)]"
                style={{ textDecoration: 'none' }}
              >
                {inner}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomTabBar;
