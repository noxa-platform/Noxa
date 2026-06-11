'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { signOut } from '@/lib/auth';
import { db } from '@/lib/firebase/config';
import { useShopContext, useDeviceClaims } from '@/lib/useShopContext';
import { useTheme } from '@/lib/useTheme';
import { useUiMode } from '@/lib/useUiMode';
import { useShopConfig, DEFAULT_MODULES } from '@/lib/shopConfig';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';

// アカウント（OS 本体）。端末では非表示。
const NAV_ACCOUNT: { label: string; href: string; icon: string }[] = [
  { label: 'ダッシュボード', href: '/account',         icon: '◇' },
  { label: 'プロフィール',   href: '/account/profile', icon: '◇' },
  { label: '公開プロフィール', href: '/account/link', icon: '◇' },
  { label: 'ログイン方法・連携', href: '/account/connections', icon: '◇' },
  { label: '退会',           href: '/account/delete',  icon: '◇' },
];

// CORE · 店舗管理 > 個人サブ
const NAV_PERSONAL: { label: string; href: string }[] = [
  { label: '売上管理',  href: '/sales' },
  { label: '顧客台帳',  href: '/customers' },
  { label: '伝票計算',  href: '/calc' },
  { label: '名刺発注',  href: '/business-card' },
  { label: 'スケジュール', href: '/schedule' },
  { label: '目標',      href: '/goals' },
];

// CORE · 店舗管理 > 店舗サブ（オーナー / 店舗端末のみ）
const NAV_STORE: { label: string; href: string }[] = [
  { label: 'POS',         href: '/pos' },
  { label: '席回し',      href: '/seating' },
  { label: '勤怠',        href: '/attendance' },
  { label: '給与',        href: '/payroll' },
  { label: '初回案内',    href: '/first-visit' },
  { label: '送迎',        href: '/transport' },
  { label: '在庫',        href: '/inventory' },
  { label: '体験入店',    href: '/trial' },
  { label: '予約',   href: '/reservation' },
  { label: '売掛管理',    href: '/unpaid' },
  { label: 'リスク客共有', href: '/risk' },
];

// CHANNEL（NOXA Channel = community / 通知）
const NAV_CHANNEL: { label: string; href: string; tint?: string }[] = [
  { label: 'community', href: '/community', tint: '#C4384A' },
  { label: '通知センター', href: '/notifications', tint: '#B89CFB' },
];

// SERVICE（連携・契約）
const NAV_SERVICE: { label: string; href: string; external?: boolean; tint?: string }[] = [
  { label: 'nomishugy', href: 'https://nomishugy.vercel.app', external: true, tint: '#B89CFB' },
  { label: 'プラン',     href: '/account/subscription' },
  { label: 'クレジット', href: '/account/credits' },
];

export function AccountShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasShop } = useShopContext(user.uid);
  const device = useDeviceClaims(user);
  useTheme(user); // 業種テーマ（コンカフェ等）を <html data-theme> に適用
  const easy = useUiMode() === 'easy'; // かんたんモード（既定）でナビを大きく
  const cfg = useShopConfig(user); // 店舗のモジュール構成（有効/並び/名称）

  // 店舗デバイス＝許可モジュールのみ。オーナー＝店舗設定の構成（有効/並び/名称）に従う
  const ownerNav = cfg.config.modules
    .filter((m) => m.enabled)
    .map((m) => ({ label: m.label?.trim() || (DEFAULT_MODULES.find((d) => d.key === m.key)?.label ?? m.key), href: `/${m.key}` }));
  const storeNav = device.isDevice
    ? NAV_STORE.filter((it) => device.allow.includes(it.href.slice(1)))
    : (cfg.loading ? NAV_STORE : ownerNav);

  // ハンドル必須化: 個人ユーザーで handle 未設定なら オンボーディングへ誘導（店舗端末は除外）
  const [needsHandle, setNeedsHandle] = useState(false);
  useEffect(() => {
    if (device.loading || device.isDevice) return;
    let alive = true;
    getDoc(doc(db, `account_users/${user.uid}`)).then((s) => {
      if (!alive) return;
      const h = s.exists() ? (s.data() as { handle?: string }).handle : undefined;
      if (!h) { setNeedsHandle(true); if (pathname !== '/account/onboarding') router.replace('/account/onboarding'); }
      else setNeedsHandle(false);
    }).catch(() => { /* 取得失敗時はブロックしない */ });
    return () => { alive = false; };
  }, [device.loading, device.isDevice, user.uid, pathname, router]);

  if (needsHandle && pathname !== '/account/onboarding') {
    return <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--noxa-text-muted)' }}>ハンドル設定へ移動中…</div>;
  }

  // ── 描画ヘルパー ──
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className={easy ? 'px-2.5 pb-2' : 'noxa-mono px-2.5 pb-2'} style={easy
      ? { fontSize: 13, color: 'var(--noxa-text-muted)', fontWeight: 700, fontFamily: 'var(--noxa-font-display-jp)' }
      : { fontSize: 10, color: 'var(--noxa-text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{children}</div>
  );
  const SubLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="px-2.5 pb-1" style={{ fontSize: easy ? 13 : 10, color: 'var(--noxa-text-muted)', fontWeight: 600 }}>{children}</div>
  );
  const navLink = (it: { label: string; href: string; external?: boolean; tint?: string }) => {
    const active = pathname === it.href;
    return (
      <Link key={it.href + it.label} href={it.href} target={it.external ? '_blank' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: easy ? '13px 12px' : '8px 10px', borderRadius: 10, background: active ? 'rgba(139, 92, 246, 0.12)' : 'transparent', color: active ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)', fontSize: easy ? 16 : 13, fontWeight: active ? 600 : (easy ? 500 : 400), textDecoration: 'none' }}>
        <span aria-hidden style={{ width: easy ? 8 : 6, height: easy ? 8 : 6, borderRadius: 4, background: active ? 'var(--noxa-accent-primary-ink)' : (it.tint ?? 'var(--noxa-text-faint)') }} />
        <span>{it.label}</span>
        {it.external && <span className="noxa-mono" style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--noxa-text-faint)' }}>↗</span>}
      </Link>
    );
  };

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
        <Link href="/" className="px-2" style={{ display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/noxa-logo-horizontal.png" alt="Noxa" style={{ height: 40, width: 'auto', display: 'block' }} />
        </Link>

        {device.isDevice && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(139,92,246,0.10)', border: '1px solid var(--noxa-border-strong)' }}>
            <div className="noxa-mono" style={{ fontSize: 10, color: 'var(--noxa-accent-primary-ink)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>店舗端末</div>
            <div style={{ fontSize: 13, color: 'var(--noxa-text-primary)', marginTop: 2 }}>{device.label || 'デバイス'}</div>
            <div style={{ fontSize: 10, color: 'var(--noxa-text-faint)', marginTop: 4 }}>給与・売掛・個人機能は非表示</div>
          </div>
        )}

        {/* ワークスペース切替（個人 / 各店舗）。端末は固定なので非表示 */}
        {!device.isDevice && <WorkspaceSwitcher user={user} />}

        <div className="flex flex-col" style={{ gap: 2, display: device.isDevice ? 'none' : undefined }}>
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

        {/* CORE · 店舗管理（個人 / 店舗 サブ。端末は許可された店舗モジュールのみ） */}
        {device.isDevice ? (
          <div className="flex flex-col" style={{ gap: 2 }}>
            <SectionLabel>{easy ? '店舗の端末' : 'Core · 店舗端末'}{device.label ? ` · ${device.label}` : ''}</SectionLabel>
            {storeNav.map(navLink)}
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 12 }}>
            <SectionLabel>{easy ? 'お店の管理' : 'Core · 店舗管理'}</SectionLabel>
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SubLabel>個人</SubLabel>
              {NAV_PERSONAL.map(navLink)}
            </div>
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SubLabel>店舗</SubLabel>
              {hasShop ? (
                <>
                  {storeNav.map(navLink)}
                  {navLink({ label: '店舗設定', href: '/store/settings' })}
                </>
              ) : (
                <Link href="/store/new" style={{ display: 'block', padding: '12px', borderRadius: 10, border: '1px dashed var(--noxa-border-strong)', color: 'var(--noxa-text-muted)', fontSize: 12, textDecoration: 'none', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--noxa-accent-primary-ink)', fontWeight: 600 }}>＋ 店舗を登録</span>
                  <br />店舗運営モジュール（POS / 勤怠 / 給与…）が解放されます
                </Link>
              )}
            </div>
          </div>
        )}

        {/* CHANNEL · NOXA Channel（community / 通知）。端末では非表示 */}
        {!device.isDevice && (
          <div className="flex flex-col" style={{ gap: 2 }}>
            <SectionLabel>{easy ? 'おしらせ・つながり' : 'Channel'}</SectionLabel>
            {NAV_CHANNEL.map(navLink)}
          </div>
        )}

        {/* SERVICE · 連携 / 契約。端末では非表示 */}
        {!device.isDevice && (
          <div className="flex flex-col" style={{ gap: 2 }}>
            <SectionLabel>{easy ? '連携・契約' : 'Service'}</SectionLabel>
            {NAV_SERVICE.map(navLink)}
          </div>
        )}

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
        <Link href="/" style={{ display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/noxa-logo-horizontal.png" alt="Noxa" style={{ height: 28, width: 'auto', display: 'block' }} />
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
