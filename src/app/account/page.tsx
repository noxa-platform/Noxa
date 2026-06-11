'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { useShopContext } from '@/lib/useShopContext';
import { useUiMode } from '@/lib/useUiMode';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

interface Sub {
  planTier: string;
  status?: string;
  aiCreditsTotal: number;
  aiCreditsUsed?: number;
  currentPeriodEnd?: { seconds: number } | null;
}

const PERSONAL_MODULES = [
  { label: '売上管理',    tag: 'CRM・実データ',  href: '/sales', real: true },
  { label: '顧客台帳',    tag: '個人 CRM / カルテ', href: '/customers', real: true },
  { label: '名刺発注',    tag: 'オリシャン',     href: '/business-card' },
  { label: 'スケジュール', tag: '出勤 / イベント / MTG', href: '/schedule' },
  { label: '目標',        tag: '月目標 / バック',  href: '/goals' },
];

const STORE_MODULES = [
  { label: 'POS',         tag: 'オーダー / 伝票', href: '/pos' },
  { label: '席回し',      tag: 'フロアマップ',    href: '/seating' },
  { label: '勤怠',        tag: '打刻 / シフト',   href: '/attendance' },
  { label: '給与',        tag: '明細 / 月締め',   href: '/payroll' },
  { label: '初回案内',    tag: '新人 OJT',        href: '/first-visit' },
  { label: '送迎',        tag: '配車ボード',      href: '/transport' },
  { label: '在庫',        tag: '発注 / ボトル',   href: '/inventory' },
  { label: '体験入店',    tag: '体験 → 採用',     href: '/trial' },
  { label: '予約',   tag: '来店予約',        href: '/reservation' },
  { label: '売掛管理',    tag: '未収金',          href: '/unpaid' },
  { label: 'リスク客共有', tag: '出禁 / 要注意',   href: '/risk' },
];

const SERVICES = [
  {
    name: 'nomishugy',
    tag: '大阪バーポータル',
    url: 'https://nomishugy.vercel.app',
    tint: '#B89CFB',
    status: 'アクティブ',
    statusColor: '#7BE8A1',
  },
  {
    name: 'community',
    tag: '交流掲示板',
    url: '/community',
    tint: '#C4384A',
    status: '近日公開',
    statusColor: '#A89FBE',
    soon: true,
  },
];

function AccountDashboard({ user }: { user: User }) {
  const [sub, setSub] = useState<Sub | null>(null);
  const { hasShop } = useShopContext(user.uid);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, `account_subscriptions/${user.uid}`));
      if (snap.exists()) setSub(snap.data() as Sub);
    })();
  }, [user.uid]);

  const planTier = sub?.planTier ?? 'free';
  const planLabel = planTier === 'free' ? 'Noxa Free' : `Noxa ${planTier.charAt(0).toUpperCase()}${planTier.slice(1)}`;
  const totalCredits = sub?.aiCreditsTotal ?? 0;
  const usedCredits = sub?.aiCreditsUsed ?? 0;
  const remainingCredits = totalCredits - usedCredits;
  const usagePct = totalCredits > 0 ? Math.min(100, Math.max(0, (remainingCredits / totalCredits) * 100)) : 0;
  const displayName = user.displayName ?? (user.email?.split('@')[0] ?? 'Noxa ユーザー');
  const easy = useUiMode() === 'easy';

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>{easy ? 'マイページ' : 'Account'}</div>
      <div className="flex items-baseline justify-between flex-wrap gap-3" style={{ marginBottom: 32 }}>
        <h1
          className="noxa-h1"
          style={{ margin: 0 }}
        >
          こんばんは、
          <span
            style={{
              color: 'var(--noxa-accent-primary-ink)',
              fontFamily: 'var(--noxa-font-display-jp)',
            }}
          >
            {displayName}
          </span>{' '}
          さん
        </h1>
        <Link
          href="/account/profile"
          className="noxa-btn noxa-btn-secondary"
          style={{ padding: '10px 16px', fontSize: 13 }}
        >
          設定 →
        </Link>
      </div>

      {/* Plan + Credits */}
      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', marginBottom: 32 }}>
        {/* Plan card */}
        <div
          className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #1A1228 0%, #221830 100%)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 'var(--noxa-radius-lg)',
            padding: 28,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute', top: -60, right: -60,
              width: 240, height: 240,
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.22) 0%, transparent 60%)',
            }}
          />
          <div className="relative">
            <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Current plan</div>
            <div className="flex items-baseline gap-3.5 flex-wrap" style={{ marginBottom: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontSize: 36,
                  color: 'var(--noxa-text-primary)',
                  fontWeight: 500,
                }}
              >
                {planLabel}
              </span>
              {planTier !== 'free' && (
                <span
                  style={{
                    padding: '3px 9px',
                    background: 'rgba(184, 156, 251, 0.22)',
                    color: 'var(--noxa-accent-primary-faint)',
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                  }}
                >
                  ACTIVE
                </span>
              )}
            </div>
            {sub?.currentPeriodEnd && (
              <div style={{ color: 'var(--noxa-text-muted)', fontSize: 13, marginBottom: 22 }}>
                次回更新 {new Date(sub.currentPeriodEnd.seconds * 1000).toLocaleDateString('ja-JP')}
              </div>
            )}
            <div className="noxa-hairline" style={{ marginBottom: 16 }} />
            <div
              className="flex gap-5 flex-wrap"
              style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}
            >
              <span><span style={{ color: '#7BE8A1' }}>●</span> 業務モジュール 9</span>
              <span><span style={{ color: '#7BE8A1' }}>●</span> nomishugy 連携</span>
              <span><span style={{ color: 'var(--noxa-accent-primary-ink)' }}>●</span> Community 早期アクセス</span>
            </div>
          </div>
        </div>

        {/* Credits card */}
        <div
          className="flex flex-col"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 'var(--noxa-radius-lg)',
            padding: 28,
            gap: 14,
          }}
        >
          <div className="noxa-eyebrow">Credits</div>
          <div className="flex items-baseline gap-1.5">
            <span
              style={{
                fontFamily: 'var(--noxa-font-display-en)',
                fontSize: 48,
                color: 'var(--noxa-accent-primary-ink)',
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              {remainingCredits.toLocaleString()}
            </span>
            <span style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>
              / {totalCredits.toLocaleString()}
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--noxa-surface-muted)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${usagePct}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #8B5CF6 0%, #B89CFB 100%)',
                transition: 'width var(--noxa-duration-slow) var(--noxa-ease-standard)',
              }}
            />
          </div>
          <Link
            href="/account/credits"
            className="noxa-btn noxa-btn-primary"
            style={{ padding: '10px 14px', fontSize: 13, alignSelf: 'flex-start' }}
          >
            履歴を見る
          </Link>
        </div>
      </div>

      {/* 個人機能 */}
      <div style={{ marginBottom: 14 }}>
        <h2 className="noxa-h2" style={{ margin: 0 }}>個人機能</h2>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 32 }}>
        {PERSONAL_MODULES.map((m) => (
          <Link key={m.href} href={m.href} className="flex flex-col" style={{ background: 'var(--noxa-surface-card)', border: `1px solid ${m.real ? 'var(--noxa-border-strong)' : 'var(--noxa-border)'}`, borderRadius: 14, padding: easy ? 22 : 18, gap: 8, textDecoration: 'none', boxShadow: m.real ? 'var(--noxa-glow-soft)' : 'none' }}>
            <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: easy ? 21 : 18, fontWeight: easy ? 700 : 500, color: 'var(--noxa-text-primary)' }}>{m.label}</span>
            <span style={{ color: 'var(--noxa-text-muted)', fontSize: easy ? 13 : 12 }}>{m.tag}</span>
            <span className={easy ? undefined : 'noxa-mono'} style={{ color: m.real ? 'var(--noxa-status-success)' : 'var(--noxa-accent-primary-ink)', fontSize: easy ? 15 : 12, fontWeight: easy ? 700 : 400, marginTop: 'auto' }}>{easy ? 'ひらく →' : (m.real ? '実データ · 開く →' : '開く →')}</span>
          </Link>
        ))}
      </div>

      {/* 店舗運営（店舗オーナー時のみ） */}
      {hasShop ? (
        <>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2 className="noxa-h2" style={{ margin: 0 }}>店舗運営</h2>
            <span style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>店舗端末では給与/売掛/リスク客は非表示</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 32 }}>
            {STORE_MODULES.map((m) => (
              <Link key={m.href} href={m.href} className="flex flex-col" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: easy ? 20 : 16, gap: 6, textDecoration: 'none' }}>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: easy ? 20 : 16, fontWeight: easy ? 700 : 500, color: 'var(--noxa-text-primary)' }}>{m.label}</span>
                <span style={{ color: 'var(--noxa-text-muted)', fontSize: easy ? 13 : 11 }}>{m.tag}</span>
                <span className={easy ? undefined : 'noxa-mono'} style={{ color: '#8B5CF6', fontSize: easy ? 15 : 11, fontWeight: easy ? 700 : 400, marginTop: 'auto' }}>{easy ? 'ひらく →' : '開く →'}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <Link href="/store/new" className="flex flex-col" style={{ background: 'var(--noxa-surface-card)', border: '1px dashed var(--noxa-border-strong)', borderRadius: 16, padding: 24, gap: 8, textDecoration: 'none', marginBottom: 32 }}>
          <span className="noxa-eyebrow">店舗運営</span>
          <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 18, fontWeight: 500, color: 'var(--noxa-text-primary)' }}>＋ 店舗を登録すると解放</span>
          <span style={{ color: 'var(--noxa-text-muted)', fontSize: 12 }}>POS・席回し・勤怠・給与・初回案内・送迎・在庫・体験入店・予約・売掛・リスク客共有。店舗端末は店舗管理パスワードでデバイスログイン。</span>
          <span className="noxa-mono" style={{ color: 'var(--noxa-accent-primary-ink)', fontSize: 12 }}>店舗を登録する →</span>
        </Link>
      )}

      {/* Services */}
      <div style={{ marginBottom: 16 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="noxa-h2" style={{ margin: 0 }}>
            連携サービス
          </h2>
          <span style={{ color: 'var(--noxa-text-muted)', fontSize: 13 }}>
            {SERVICES.filter((s) => !s.soon).length} つ利用可能
          </span>
        </div>
      </div>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
      >
        {SERVICES.map((s) => (
          <Link
            key={s.name}
            href={s.url}
            target={s.url.startsWith('http') ? '_blank' : undefined}
            className="flex flex-col"
            style={{
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 16,
              padding: 22,
              gap: 12,
              opacity: s.soon ? 0.78 : 1,
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: `${s.tint}22`,
                    color: s.tint,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--noxa-font-display-en)',
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  {s.name[0].toUpperCase()}
                </span>
                <div>
                  <div
                    className="noxa-mono"
                    style={{
                      color: 'var(--noxa-text-primary)',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {s.name}
                  </div>
                  <div
                    style={{
                      color: 'var(--noxa-text-muted)',
                      fontSize: 11,
                      fontFamily: 'var(--noxa-font-sans-jp)',
                    }}
                  >
                    {s.tag}
                  </div>
                </div>
              </div>
              <span
                className="inline-flex items-center gap-1.5"
                style={{ color: s.statusColor, fontSize: 11 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 5, height: 5, borderRadius: 3,
                    background: s.statusColor,
                  }}
                />
                {s.status}
              </span>
            </div>
            <div className="noxa-hairline" style={{ background: 'rgba(76, 29, 149, 0.30)' }} />
            <div
              className="noxa-mono"
              style={{
                color: s.soon ? 'var(--noxa-text-faint)' : s.tint,
                fontSize: 12,
                marginTop: 'auto',
              }}
            >
              {s.soon ? '通知を受け取る →' : 'open →'}
            </div>
          </Link>
        ))}
      </div>
    </AccountShell>
  );
}

export default function AccountPage() {
  return <AuthGuard>{(user) => <AccountDashboard user={user} />}</AuthGuard>;
}
