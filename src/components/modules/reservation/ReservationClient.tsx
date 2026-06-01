'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * 予約・VIP来店モジュール — モック（ガワ）
 *
 * 本日の予約タイムライン + VIP 客リストを表示する。
 * データは全てモック。Firestore 連携は今後の実装。
 */

const mono = 'var(--noxa-font-mono)';

// ステータス定義
type ReservationStatus = '未来店' | '来店済' | 'キャンセル';

type Reservation = {
  id: string;
  time: string;       // HH:MM
  guestName: string;
  castName: string;   // 指名キャスト
  partySize: number;
  table: string;      // 卓番号
  status: ReservationStatus;
  note?: string;
};

type VipGuest = {
  id: string;
  name: string;
  totalSales: number;
  visitCount: number;
  preferences: string[];
  nextVisit: string | null; // YYYY-MM-DD or null
  rank: 'PLATINUM' | 'GOLD' | 'SILVER';
};

// ---- モックデータ ----
const MOCK_RESERVATIONS: Reservation[] = [
  { id: 'r1', time: '19:30', guestName: '田中 様',   castName: 'あやか',   partySize: 2, table: 'A-1', status: '来店済' },
  { id: 'r2', time: '20:00', guestName: '鈴木 様',   castName: 'みき',     partySize: 3, table: 'B-2', status: '来店済' },
  { id: 'r3', time: '20:30', guestName: '山本 様',   castName: 'りえ',     partySize: 1, table: 'C-1', status: '来店済' },
  { id: 'r4', time: '21:00', guestName: '松田 様',   castName: 'あやか',   partySize: 4, table: 'A-2', status: '未来店', note: '誕生日サプライズあり' },
  { id: 'r5', time: '21:30', guestName: '中村 様',   castName: 'さき',     partySize: 2, table: 'D-1', status: '未来店' },
  { id: 'r6', time: '22:00', guestName: '高橋 様',   castName: 'みき',     partySize: 3, table: 'B-3', status: 'キャンセル', note: '急用により' },
  { id: 'r7', time: '22:30', guestName: '伊藤 様',   castName: 'りえ',     partySize: 2, table: 'E-1', status: '未来店' },
];

const MOCK_VIPS: VipGuest[] = [
  { id: 'v1', name: '田中 社長',   totalSales: 4800000, visitCount: 62, preferences: ['シャンパン', 'ボックス席', 'あやか指名'], nextVisit: '2026-06-07', rank: 'PLATINUM' },
  { id: 'v2', name: '松田 オーナー', totalSales: 2100000, visitCount: 41, preferences: ['ウイスキー', '夜遅め', 'さき指名'],   nextVisit: '2026-06-10', rank: 'GOLD' },
  { id: 'v3', name: '中村 部長',   totalSales: 980000,  visitCount: 28, preferences: ['カクテル', '仕事帰り', 'みき指名'],   nextVisit: null,          rank: 'GOLD' },
  { id: 'v4', name: '高橋 様',     totalSales: 650000,  visitCount: 19, preferences: ['ビール', 'カウンター席'],             nextVisit: '2026-06-14', rank: 'SILVER' },
  { id: 'v5', name: '伊藤 代表',   totalSales: 520000,  visitCount: 15, preferences: ['日本酒', 'りえ指名', '個室希望'],    nextVisit: null,          rank: 'SILVER' },
];

// ---- ヘルパー ----
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

const STATUS_COLOR: Record<ReservationStatus, { text: string; bg: string; border: string }> = {
  '来店済':     { text: 'var(--noxa-status-success)',  bg: 'rgba(123,232,161,0.10)', border: 'rgba(123,232,161,0.30)' },
  '未来店':     { text: 'var(--noxa-text-muted)',       bg: 'rgba(255,255,255,0.05)', border: 'var(--noxa-border)' },
  'キャンセル': { text: 'var(--noxa-status-warning)',   bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.30)' },
};

const RANK_LABEL: Record<VipGuest['rank'], { label: string; color: string }> = {
  PLATINUM: { label: 'PLATINUM', color: '#E8D9B4' },
  GOLD:     { label: 'GOLD',     color: '#D4B27A' },
  SILVER:   { label: 'SILVER',   color: '#A8B8C8' },
};

export function ReservationClient() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'vip'>('timeline');

  const todayCounts = {
    total:     MOCK_RESERVATIONS.length,
    arrived:   MOCK_RESERVATIONS.filter((r) => r.status === '来店済').length,
    upcoming:  MOCK_RESERVATIONS.filter((r) => r.status === '未来店').length,
    cancelled: MOCK_RESERVATIONS.filter((r) => r.status === 'キャンセル').length,
  };

  return (
    <div
      style={{
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景グロー */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(212,178,122,0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* breadcrumb */}
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol
            style={{
              display: 'flex',
              gap: 8,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-text-faint)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              <Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li>reservation</li>
          </ol>
        </nav>

        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
              Noxa OS · Module 08 · Reservation & VIP
            </div>
            <h1
              className="noxa-display"
              style={{
                fontSize: 'clamp(26px, 4vw, 38px)',
                margin: 0,
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontStyle: 'italic',
                  color: 'var(--noxa-accent-primary-ink)',
                  fontWeight: 400,
                }}
              >
                №&nbsp;08
              </span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                予約・VIP来店
              </span>
            </h1>
          </div>
          {/* モックバッジ */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(212,178,122,0.10)',
              border: '1px solid rgba(212,178,122,0.30)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: '#D4B27A',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: '#D4B27A',
                boxShadow: '0 0 8px #D4B27A',
              }}
            />
            モック
          </div>
        </div>

        {/* KPI サマリ */}
        <div
          role="list"
          aria-label="本日の予約サマリ"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 12, marginBottom: 20 }}
        >
          <KpiCard label="本日の予約" value={String(todayCounts.total)} unit="件" />
          <KpiCard label="来店済"     value={String(todayCounts.arrived)}   unit="件" accent />
          <KpiCard label="未来店"     value={String(todayCounts.upcoming)}  unit="件" />
          <KpiCard label="キャンセル" value={String(todayCounts.cancelled)} unit="件" warn />
        </div>

        {/* タブ切り替え */}
        <div
          role="tablist"
          aria-label="表示切り替え"
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 16,
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 10,
            padding: 4,
          }}
        >
          {(['timeline', 'vip'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '7px 12px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                transition: 'background 0.15s, color 0.15s',
                background: activeTab === tab ? 'var(--noxa-surface-muted)' : 'transparent',
                color: activeTab === tab ? 'var(--noxa-text-primary)' : 'var(--noxa-text-faint)',
              }}
            >
              {tab === 'timeline' ? '本日のタイムライン' : 'VIP 客リスト'}
            </button>
          ))}
        </div>

        {/* タブパネル：タイムライン */}
        {activeTab === 'timeline' && (
          <section aria-label="本日の予約タイムライン">
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {MOCK_RESERVATIONS.map((r) => {
                const s = STATUS_COLOR[r.status];
                return (
                  <li
                    key={r.id}
                    style={{
                      background: 'var(--noxa-surface-card)',
                      border: '1px solid var(--noxa-border)',
                      borderRadius: 14,
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 14,
                        flexWrap: 'wrap',
                      }}
                    >
                      {/* 時刻 */}
                      <time
                        dateTime={r.time}
                        style={{
                          fontFamily: mono,
                          fontSize: 20,
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          color: 'var(--noxa-accent-primary-ink)',
                          lineHeight: 1,
                          minWidth: 52,
                        }}
                      >
                        {r.time}
                      </time>

                      {/* 詳細 */}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{r.guestName}</span>
                          {/* ステータスバッジ */}
                          <span
                            aria-label={`ステータス: ${r.status}`}
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontFamily: mono,
                              fontSize: 10,
                              letterSpacing: '0.08em',
                              color: s.text,
                              background: s.bg,
                              border: `1px solid ${s.border}`,
                            }}
                          >
                            {r.status}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 16,
                            flexWrap: 'wrap',
                            fontFamily: mono,
                            fontSize: 11,
                            color: 'var(--noxa-text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>指名: {r.castName}</span>
                          <span>{r.partySize}名</span>
                          <span>卓: {r.table}</span>
                        </div>
                        {r.note && (
                          <p
                            style={{
                              margin: '6px 0 0',
                              fontSize: 11,
                              color: 'var(--noxa-text-faint)',
                              fontStyle: 'italic',
                            }}
                          >
                            ※ {r.note}
                          </p>
                        )}
                      </div>

                      {/* アクションボタン */}
                      {r.status === '未来店' && (
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                          <ActionButton
                            label="卓を割り当て"
                            onClick={() => {/* no-op */ }}
                          />
                          <ActionButton
                            label="確認連絡"
                            onClick={() => {/* no-op */ }}
                            secondary
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* タブパネル：VIP 客リスト */}
        {activeTab === 'vip' && (
          <section aria-label="VIP 客リスト">
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {MOCK_VIPS.map((v) => {
                const rank = RANK_LABEL[v.rank];
                return (
                  <li
                    key={v.id}
                    style={{
                      background: 'var(--noxa-surface-card)',
                      border: `1px solid ${v.rank === 'PLATINUM' ? 'rgba(232,217,180,0.35)' : 'var(--noxa-border)'}`,
                      borderRadius: 16,
                      padding: '16px 18px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      {/* 名前 + バッジ */}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontSize: 15, fontWeight: 600 }}>{v.name}</span>
                          {/* VIP ランクバッジ */}
                          <span
                            aria-label={`ランク: ${rank.label}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontFamily: mono,
                              fontSize: 9,
                              letterSpacing: '0.14em',
                              color: rank.color,
                              background: `${rank.color}18`,
                              border: `1px solid ${rank.color}50`,
                            }}
                          >
                            ★ {rank.label}
                          </span>
                        </div>

                        {/* 統計 */}
                        <div
                          style={{
                            display: 'flex',
                            gap: 18,
                            flexWrap: 'wrap',
                            fontFamily: mono,
                            fontSize: 11,
                            color: 'var(--noxa-text-muted)',
                            marginBottom: 10,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          <span>
                            累計:{' '}
                            <strong style={{ color: '#D4B27A', fontWeight: 700 }}>
                              {yen(v.totalSales)}
                            </strong>
                          </span>
                          <span>来店: {v.visitCount} 回</span>
                          <span>
                            次回:{' '}
                            {v.nextVisit
                              ? <time dateTime={v.nextVisit}>{v.nextVisit.replace(/^2026-/, '')}</time>
                              : '未定'}
                          </span>
                        </div>

                        {/* 好み タグ */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {v.preferences.map((p) => (
                            <span
                              key={p}
                              style={{
                                padding: '2px 8px',
                                background: 'var(--noxa-surface-muted)',
                                border: '1px solid var(--noxa-border)',
                                borderRadius: 6,
                                fontFamily: mono,
                                fontSize: 10,
                                color: 'var(--noxa-text-faint)',
                              }}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* アクションボタン */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                        <ActionButton
                          label="卓を割り当て"
                          onClick={() => {/* no-op */ }}
                        />
                        <ActionButton
                          label="確認連絡"
                          onClick={() => {/* no-op */ }}
                          secondary
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* フッター注記 */}
        <p
          style={{
            margin: '20px 0 0',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
          }}
        >
          ※ 現在はモック表示。Firestore 連携・リアルタイム更新は今後実装予定。
        </p>
      </div>
    </div>
  );
}

// ---- サブコンポーネント ----

function KpiCard({
  label,
  value,
  unit,
  accent,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const valueColor = accent
    ? 'var(--noxa-status-success)'
    : warn
    ? 'var(--noxa-status-warning)'
    : 'var(--noxa-text-primary)';

  return (
    <div
      role="listitem"
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--noxa-text-faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--noxa-font-display-en)',
          fontSize: 26,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
          lineHeight: 1,
        }}
      >
        {value}
        <span
          style={{
            fontSize: 12,
            fontFamily: mono,
            fontWeight: 400,
            color: 'var(--noxa-text-faint)',
            marginLeft: 4,
          }}
        >
          {unit}
        </span>
      </span>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  secondary,
}: {
  label: string;
  onClick: () => void;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        border: secondary
          ? '1px solid var(--noxa-border)'
          : '1px solid rgba(212,178,122,0.40)',
        background: secondary
          ? 'transparent'
          : 'rgba(212,178,122,0.12)',
        color: secondary
          ? 'var(--noxa-text-muted)'
          : '#D4B27A',
        fontFamily: mono,
        fontSize: 11,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  );
}

export default ReservationClient;
