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
import { BottomTabBar } from '@/components/BottomTabBar';

// メニューのアイコン（href→絵文字）。非tech層に分かりやすいよう視覚記号を付与。
const ICONS: Record<string, string> = {
  '/account': '🏠', '/account/profile': '👤', '/account/link': '🔗', '/account/connections': '🔐', '/account/delete': '🚪',
  '/sales': '💰', '/customers': '📒', '/goals': '🎯', '/calc': '🧮',
  '/pos': '🧾', '/seating': '🪑', '/attendance': '⏰', '/payroll': '💴', '/first-visit': '✨', '/store/settings': '⚙️',
  '/transport': '🚗', '/inventory': '📦', '/trial': '🌱', '/reservation': '📅', '/unpaid': '📌', '/risk': '⚠️',
  '/business-card': '💳', '/schedule': '🗓️',
  '/community': '💬', '/notifications': '🔔',
  'https://nomishugy.vercel.app': '🍶', '/account/subscription': '💎', '/account/credits': '🪙', '/store/new': '🏪',
};

// マイページ（OS 本体）。端末では非表示。
const NAV_ACCOUNT: { label: string; href: string }[] = [
  { label: 'ホーム',         href: '/account' },
  { label: 'プロフィール',   href: '/account/profile' },
  { label: '公開プロフィール', href: '/account/link' },
  { label: 'ログイン・連携', href: '/account/connections' },
];

// 売上・顧客（個人/店舗どちらのワークスペースでも使う）
const NAV_MONEY: { label: string; href: string }[] = [
  { label: '売上',      href: '/sales' },
  { label: '顧客台帳',  href: '/customers' },
  { label: '目標',      href: '/goals' },
];

// 個人ツール
const NAV_TOOLS: { label: string; href: string }[] = [
  { label: '伝票計算',  href: '/calc' },
  { label: '名刺発注',  href: '/business-card' },
  { label: 'スケジュール', href: '/schedule' },
];

// お店の運営（店舗ワークスペース選択中 / 店舗端末のみ）
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

// NOXA / おしらせ
const NAV_CHANNEL: { label: string; href: string; tint?: string }[] = [
  { label: 'コミュニティ', href: '/community', tint: '#C4384A' },
  { label: 'おしらせ', href: '/notifications', tint: '#B89CFB' },
];

// 連携・契約
const NAV_SERVICE: { label: string; href: string; external?: boolean; tint?: string }[] = [
  { label: 'のみしゅぎ', href: 'https://nomishugy.vercel.app', external: true, tint: '#B89CFB' },
  { label: 'プラン',     href: '/account/subscription' },
  { label: 'クレジット', href: '/account/credits' },
  { label: '退会',       href: '/account/delete' },
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
  // 「お店の運営」を出すのは店舗ワークスペース選択中（cfg.shopId あり）or 店舗端末。個人選択中は隠す
  const storeActive = device.isDevice || (!cfg.loading && !!cfg.shopId);

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
  const navLink = (it: { label: string; href: string; external?: boolean; tint?: string }) => {
    const active = pathname === it.href;
    return (
      <Link key={it.href + it.label} href={it.href} target={it.external ? '_blank' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: easy ? '12px 12px' : '8px 10px', borderRadius: 10, background: active ? 'rgba(139, 92, 246, 0.14)' : 'transparent', color: active ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)', fontSize: easy ? 16 : 13, fontWeight: active ? 600 : (easy ? 500 : 400), textDecoration: 'none' }}>
        <span aria-hidden style={{ width: easy ? 26 : 22, fontSize: easy ? 18 : 15, textAlign: 'center', flex: 'none', filter: active ? 'none' : 'grayscale(0.2)' }}>{ICONS[it.href] ?? '•'}</span>
        <span>{it.label}</span>
        {it.external && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--noxa-text-faint)' }}>↗</span>}
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

        {device.isDevice ? (
          /* 店舗端末: 許可された店舗モジュールのみ */
          <div className="flex flex-col" style={{ gap: 2 }}>
            <SectionLabel>店舗の端末{device.label ? ` · ${device.label}` : ''}</SectionLabel>
            {storeNav.map(navLink)}
          </div>
        ) : (
          <>
            {/* お店の運営（店舗を選択中のみ表示。個人選択中は隠す） */}
            {storeActive ? (
              <div className="flex flex-col" style={{ gap: 2 }}>
                <SectionLabel>お店の運営</SectionLabel>
                {storeNav.map(navLink)}
                {navLink({ label: '店舗設定', href: '/store/settings' })}
              </div>
            ) : !hasShop ? (
              <Link href="/store/new" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, border: '1px dashed var(--noxa-border-strong)', color: 'var(--noxa-text-muted)', fontSize: 13, textDecoration: 'none', lineHeight: 1.5 }}>
                <span aria-hidden style={{ fontSize: 18 }}>🏪</span>
                <span><span style={{ color: 'var(--noxa-accent-primary-ink)', fontWeight: 700 }}>＋ お店を登録</span><br />席回し・POS・勤怠などが使えます</span>
              </Link>
            ) : null}

            {/* 売上・顧客（個人/店舗どちらでも） */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SectionLabel>売上・顧客</SectionLabel>
              {NAV_MONEY.map(navLink)}
            </div>

            {/* マイページ */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SectionLabel>マイページ</SectionLabel>
              {NAV_ACCOUNT.map(navLink)}
            </div>

            {/* 個人ツール */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SectionLabel>個人ツール</SectionLabel>
              {NAV_TOOLS.map(navLink)}
            </div>

            {/* NOXA / おしらせ */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SectionLabel>NOXA・おしらせ</SectionLabel>
              {NAV_CHANNEL.map(navLink)}
            </div>

            {/* 連携・契約 */}
            <div className="flex flex-col" style={{ gap: 2 }}>
              <SectionLabel>連携・契約</SectionLabel>
              {NAV_SERVICE.map(navLink)}
            </div>
          </>
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
      <main className="flex-1 overflow-auto px-5 md:px-10 pt-20 md:pt-9 pb-24 md:pb-10">
        {children}
      </main>

      {/* モバイル下部ナビ（スマホでメニューに到達できるように。端末kioskでは非表示） */}
      {!device.isDevice && <BottomTabBar />}
    </div>
  );
}
