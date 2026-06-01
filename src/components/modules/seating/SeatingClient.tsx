'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ③ 席回し — フロアマップ + キャストローテーション UI モック（ガワのみ）
 *
 * ロジック・永続化なし。すべて MOCK_* のモックデータ。UI 内部 state
 * （卓選択ハイライト）のみ useState で実装。ボタンは no-op。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

type TableStatus = 'empty' | 'occupied' | 'checkout' | 'reserved';

type MockTable = {
  id: string;
  name: string;
  status: TableStatus;
  guestName?: string;   // 客名
  castName?: string;    // 指名キャスト名
  elapsed?: string;     // 滞在時間（表示用）
  elapsedMin?: number;  // 滞在時間（分、アラート判定用）
  guests?: number;      // 来店人数
  col: number;          // CSS grid 列（1〜4）
  row: number;          // CSS grid 行（1〜3）
};

const MOCK_TABLES: MockTable[] = [
  { id: 'T1',  name: '卓1',  status: 'occupied',  guestName: '田中様',  castName: '凛',  elapsed: '1:42', elapsedMin: 102, guests: 2, col: 1, row: 1 },
  { id: 'T2',  name: '卓2',  status: 'occupied',  guestName: '山本様',  castName: '葵',  elapsed: '38分', elapsedMin: 38,  guests: 3, col: 2, row: 1 },
  { id: 'T3',  name: '卓3',  status: 'empty',                                                               col: 3, row: 1 },
  { id: 'T4',  name: '卓4',  status: 'reserved',  guestName: '鈴木様',                   elapsed: '21:00',                  col: 4, row: 1 },
  { id: 'T5',  name: '卓5',  status: 'checkout',  guestName: '佐藤様',  castName: '蘭',  elapsed: '2:05', elapsedMin: 125, guests: 4, col: 1, row: 2 },
  { id: 'T6',  name: '卓6',  status: 'occupied',  guestName: '伊藤様',  castName: '茉莉',elapsed: '55分', elapsedMin: 55,  guests: 2, col: 2, row: 2 },
  { id: 'T7',  name: '卓7',  status: 'empty',                                                               col: 3, row: 2 },
  { id: 'T8',  name: '卓8',  status: 'occupied',  guestName: '中村様',  castName: '雪',  elapsed: '1:10', elapsedMin: 70,  guests: 1, col: 4, row: 2 },
  { id: 'T9',  name: '卓9',  status: 'empty',                                                               col: 1, row: 3 },
  { id: 'T10', name: '卓10', status: 'checkout',  guestName: '小林様',  castName: '桃',  elapsed: '1:58', elapsedMin: 118, guests: 3, col: 2, row: 3 },
];

type CastStatus = 'waiting' | 'serving';

type MockCast = {
  id: string;
  name: string;         // 源氏名
  status: CastStatus;
  waitMin?: number;     // 待機時間（分）
  tableId?: string;     // 接客中の卓 ID
  isNextCandidate?: boolean; // 次の指名候補
};

const MOCK_CASTS: MockCast[] = [
  { id: 'C1', name: '凛',   status: 'serving',  tableId: 'T1' },
  { id: 'C2', name: '葵',   status: 'serving',  tableId: 'T2' },
  { id: 'C3', name: '蘭',   status: 'serving',  tableId: 'T5' },
  { id: 'C4', name: '茉莉', status: 'serving',  tableId: 'T6' },
  { id: 'C5', name: '雪',   status: 'serving',  tableId: 'T8' },
  { id: 'C6', name: '桃',   status: 'serving',  tableId: 'T10' },
  { id: 'C7', name: '柚',   status: 'waiting', waitMin: 22, isNextCandidate: true },
  { id: 'C8', name: '紫苑', status: 'waiting', waitMin: 8 },
];

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

const STATUS_META: Record<
  TableStatus,
  { label: string; color: string; bg: string; borderColor: string }
> = {
  empty:    { label: '空席',   color: 'var(--noxa-text-faint)',         bg: 'transparent',                    borderColor: 'var(--noxa-border)' },
  occupied: { label: '接客中', color: 'var(--noxa-accent-primary-ink)', bg: 'var(--noxa-surface-card)',        borderColor: 'var(--noxa-border-strong)' },
  checkout: { label: '会計待ち',color: 'var(--noxa-status-warning)',     bg: 'rgba(245,212,114,0.06)',         borderColor: 'rgba(245,212,114,0.40)' },
  reserved: { label: '予約',   color: 'var(--noxa-status-info)',        bg: 'rgba(103,232,249,0.06)',         borderColor: 'rgba(103,232,249,0.35)' },
};

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function SeatingClient() {
  const [selectedTable, setSelectedTable] = useState<string | null>('T1');

  // サマリ計算
  const occupiedCount  = MOCK_TABLES.filter((t) => t.status === 'occupied').length;
  const checkoutCount  = MOCK_TABLES.filter((t) => t.status === 'checkout').length;
  const emptyCount     = MOCK_TABLES.filter((t) => t.status === 'empty').length;
  const servingCasts   = MOCK_CASTS.filter((c) => c.status === 'serving').length;

  // 選択中の卓
  const selectedT = MOCK_TABLES.find((t) => t.id === selectedTable);

  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
      }}
    >
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-8%',
          width: 640,
          height: 400,
          background: 'radial-gradient(ellipse, rgba(103,232,249,0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '-5%',
          width: 480,
          height: 320,
          background: 'radial-gradient(ellipse, rgba(139,92,246,0.09) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ header ─ */}
        <header style={{ marginBottom: 20 }}>
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
                <Link href="/" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                  Noxa OS
                </Link>
              </li>
              <li aria-hidden>·</li>
              <li>seating</li>
            </ol>
          </nav>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
                Noxa OS · Module 03 · Seating
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
                  № 03
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  席回し
                </span>
              </h1>
            </div>

            {/* live badge */}
            <div
              role="status"
              aria-label="リアルタイム更新中"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(103,232,249,0.08)',
                border: '1px solid rgba(103,232,249,0.25)',
                borderRadius: 9999,
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--noxa-status-info)',
                textTransform: 'uppercase',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--noxa-status-info)',
                  boxShadow: '0 0 8px var(--noxa-status-info)',
                  animation: 'pulse 2s ease-in-out infinite',
                }}
              />
              LIVE · モック表示
            </div>
          </div>
        </header>

        {/* ─ サマリバー ─ */}
        <section
          aria-label="フロアサマリ"
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <SummaryChip
            label="稼働卓"
            value={`${occupiedCount + checkoutCount} / ${MOCK_TABLES.length}`}
            color="var(--noxa-accent-primary-ink)"
          />
          <SummaryChip
            label="空席"
            value={String(emptyCount)}
            color="var(--noxa-status-success)"
          />
          <SummaryChip
            label="接客中キャスト"
            value={`${servingCasts}名`}
            color="var(--noxa-status-info)"
          />
          <SummaryChip
            label="会計待ち"
            value={`${checkoutCount}卓`}
            color="var(--noxa-status-warning)"
          />
        </section>

        {/* ─ 2ペイン ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_260px]"
          style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}
        >
          {/* 左：フロアマップ */}
          <section aria-label="フロアマップ">
            <PaneTitle>フロアマップ</PaneTitle>

            {/* 凡例 */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
              aria-label="凡例"
            >
              {(Object.entries(STATUS_META) as [TableStatus, typeof STATUS_META[TableStatus]][]).map(
                ([key, meta]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      fontFamily: mono,
                      color: 'var(--noxa-text-faint)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: meta.color,
                        border: `1px solid ${meta.borderColor}`,
                        flex: 'none',
                      }}
                    />
                    {meta.label}
                  </div>
                )
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  fontFamily: mono,
                  color: 'var(--noxa-text-faint)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--noxa-status-warning)',
                    flex: 'none',
                  }}
                />
                90分超アラート
              </div>
            </div>

            {/* フロアグリッド */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4"
              style={{ gap: 10 }}
              role="grid"
              aria-label="フロア卓一覧"
            >
              {MOCK_TABLES.map((t) => {
                const meta    = STATUS_META[t.status];
                const active  = t.id === selectedTable;
                const alert90 = (t.elapsedMin ?? 0) >= 90;

                return (
                  <button
                    key={t.id}
                    type="button"
                    role="gridcell"
                    onClick={() => setSelectedTable(active ? null : t.id)}
                    aria-pressed={active}
                    aria-label={[
                      t.name,
                      meta.label,
                      t.guestName ?? '',
                      t.castName ? `指名:${t.castName}` : '',
                      t.elapsed  ? `滞在:${t.elapsed}` : '',
                      alert90    ? '90分超アラート' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: 90,
                      padding: '12px 14px',
                      borderRadius: 14,
                      background: active
                        ? 'rgba(139,92,246,0.12)'
                        : meta.bg,
                      border: active
                        ? '1px solid var(--noxa-accent-primary)'
                        : `1px solid ${meta.borderColor}`,
                      boxShadow: active ? 'var(--noxa-glow-ring)' : 'none',
                      transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      color: 'var(--noxa-text-primary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    {/* 卓番号 + アラート + ステータスドット */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>
                        {t.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {alert90 && (
                          <span
                            aria-label="90分超アラート"
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: 'var(--noxa-status-warning)',
                              boxShadow: '0 0 8px var(--noxa-status-warning)',
                              flex: 'none',
                            }}
                          />
                        )}
                        <span
                          aria-hidden
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 3,
                            background: meta.color,
                            boxShadow:
                              t.status !== 'empty'
                                ? `0 0 7px ${meta.color}`
                                : 'none',
                            flex: 'none',
                          }}
                        />
                      </div>
                    </div>

                    {/* ステータスラベル */}
                    <span
                      style={{ fontSize: 10, fontFamily: mono, color: meta.color }}
                    >
                      {meta.label}
                    </span>

                    {/* 客名 */}
                    {t.guestName && (
                      <span style={{ fontSize: 12, color: 'var(--noxa-text-primary)', fontWeight: 500 }}>
                        {t.guestName}
                        {t.guests != null && (
                          <span style={{ color: 'var(--noxa-text-faint)', fontWeight: 400 }}>
                            {' '}·{' '}{t.guests}名
                          </span>
                        )}
                      </span>
                    )}

                    {/* 指名キャスト */}
                    {t.castName && (
                      <span style={{ fontSize: 11, color: 'var(--noxa-text-muted)' }}>
                        指名: {t.castName}
                      </span>
                    )}

                    {/* 滞在時間 */}
                    {t.elapsed && (
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 12,
                          fontVariantNumeric: 'tabular-nums',
                          color: alert90 ? 'var(--noxa-status-warning)' : 'var(--noxa-text-faint)',
                          fontWeight: alert90 ? 600 : 400,
                          marginTop: 'auto',
                        }}
                      >
                        {t.elapsed}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 選択卓の詳細パネル */}
            {selectedT && selectedT.status !== 'empty' && (
              <div
                role="region"
                aria-label={`${selectedT.name} 詳細`}
                style={{
                  marginTop: 16,
                  padding: '14px 16px',
                  background: 'var(--noxa-surface-card)',
                  border: '1px solid var(--noxa-accent-primary)',
                  borderRadius: 14,
                  boxShadow: 'var(--noxa-glow-soft)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--noxa-font-display-jp)',
                      fontSize: 16,
                      fontWeight: 500,
                      color: 'var(--noxa-text-primary)',
                    }}
                  >
                    {selectedT.name}
                  </span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      letterSpacing: '0.10em',
                      color: STATUS_META[selectedT.status].color,
                      textTransform: 'uppercase',
                    }}
                  >
                    {STATUS_META[selectedT.status].label}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 10,
                  }}
                >
                  {selectedT.guestName && (
                    <DetailItem label="客名" value={selectedT.guestName} />
                  )}
                  {selectedT.guests != null && (
                    <DetailItem label="来店" value={`${selectedT.guests}名`} />
                  )}
                  {selectedT.castName && (
                    <DetailItem label="指名キャスト" value={selectedT.castName} />
                  )}
                  {selectedT.elapsed && (
                    <DetailItem
                      label="滞在時間"
                      value={selectedT.elapsed}
                      highlight={(selectedT.elapsedMin ?? 0) >= 90}
                    />
                  )}
                </div>

                {/* no-op アクションボタン群 */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {(['延長', '会計へ', '席移動', '退店'] as const).map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { /* ガワのみ: no-op */ }}
                      aria-label={`${selectedT.name} を ${label}`}
                      style={{
                        appearance: 'none',
                        cursor: 'pointer',
                        flex: 'none',
                        minHeight: 36,
                        padding: '7px 14px',
                        borderRadius: 9999,
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 13,
                        fontWeight: 500,
                        background:
                          label === '会計へ'
                            ? 'rgba(245,212,114,0.12)'
                            : label === '退店'
                            ? 'rgba(196,56,74,0.10)'
                            : 'var(--noxa-surface-muted)',
                        border:
                          label === '会計へ'
                            ? '1px solid rgba(245,212,114,0.40)'
                            : label === '退店'
                            ? '1px solid rgba(196,56,74,0.35)'
                            : '1px solid var(--noxa-border)',
                        color:
                          label === '会計へ'
                            ? 'var(--noxa-status-warning)'
                            : label === '退店'
                            ? 'var(--noxa-status-error)'
                            : 'var(--noxa-text-primary)',
                        transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 右：キャストローテーション */}
          <section aria-label="キャストローテーション">
            <PaneTitle>待機キャスト</PaneTitle>

            {/* 次の指名候補 */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-status-success)',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                次の指名候補
              </div>
              {MOCK_CASTS.filter((c) => c.isNextCandidate).map((c) => (
                <CastCard key={c.id} cast={c} highlight />
              ))}
            </div>

            {/* 待機中 */}
            <div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-text-faint)',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                待機中
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {MOCK_CASTS.filter((c) => c.status === 'waiting' && !c.isNextCandidate).map((c) => (
                  <CastCard key={c.id} cast={c} />
                ))}
              </div>
            </div>

            {/* 仕切り */}
            <div
              aria-hidden
              style={{
                margin: '18px 0',
                borderTop: '1px solid var(--noxa-divider)',
              }}
            />

            {/* 接客中 */}
            <div>
              <PaneTitle>接客中キャスト</PaneTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {MOCK_CASTS.filter((c) => c.status === 'serving').map((c) => {
                  const table = MOCK_TABLES.find((t) => t.id === c.tableId);
                  return (
                    <CastCard key={c.id} cast={c} tableLabel={table?.name} />
                  );
                })}
              </div>
            </div>

            {/* ローテーション操作ボタン（no-op） */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => { /* ガワのみ: no-op */ }}
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  minHeight: 44,
                  borderRadius: 12,
                  border: '1px solid var(--noxa-accent-primary)',
                  background: 'var(--noxa-accent-primary)',
                  color: '#fff',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: 'var(--noxa-glow-soft)',
                  transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                }}
                aria-label="キャストをローテーション（次の待機へ）"
              >
                ローテーション実行
              </button>
              <button
                type="button"
                onClick={() => { /* ガワのみ: no-op */ }}
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  minHeight: 44,
                  borderRadius: 12,
                  border: '1px solid var(--noxa-border-strong)',
                  background: 'var(--noxa-surface-muted)',
                  color: 'var(--noxa-text-primary)',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                }}
                aria-label="場内指名を記録"
              >
                場内指名を記録
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子コンポーネント
// ─────────────────────────────────────────────

function PaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="noxa-eyebrow"
      style={{ fontSize: 11, marginBottom: 12, display: 'block' }}
    >
      {children}
    </h2>
  );
}

function SummaryChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 14px',
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 10,
        minWidth: 110,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 8px ${color}`,
          flex: 'none',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontFamily: 'var(--noxa-font-mono)',
            fontSize: 9,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--noxa-text-faint)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--noxa-font-mono)',
            fontSize: 18,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color,
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function CastCard({
  cast,
  highlight,
  tableLabel,
}: {
  cast: MockCast;
  highlight?: boolean;
  tableLabel?: string;
}) {
  const mono = 'var(--noxa-font-mono)';
  const isWaiting = cast.status === 'waiting';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 12,
        background: highlight ? 'rgba(123,232,161,0.07)' : 'var(--noxa-surface-card)',
        border: highlight
          ? '1px solid rgba(123,232,161,0.30)'
          : '1px solid var(--noxa-border)',
        boxShadow: highlight ? '0 0 10px rgba(123,232,161,0.12)' : 'none',
        transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}
      aria-label={[
        cast.name,
        isWaiting ? `待機${cast.waitMin}分` : `接客中 ${tableLabel ?? ''}`,
        highlight ? '次の指名候補' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* アバター丸 */}
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--noxa-surface-muted)',
          border: highlight
            ? '1.5px solid var(--noxa-status-success)'
            : `1.5px solid ${isWaiting ? 'var(--noxa-border-strong)' : 'var(--noxa-accent-primary-ink)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
          fontFamily: 'var(--noxa-font-display-jp)',
          fontSize: 14,
          fontWeight: 500,
          color: highlight
            ? 'var(--noxa-status-success)'
            : isWaiting
            ? 'var(--noxa-text-muted)'
            : 'var(--noxa-accent-primary-ink)',
        }}
      >
        {cast.name.charAt(0)}
      </div>

      {/* 名前 + ステータス */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--noxa-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cast.name}
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: 10,
            color: isWaiting
              ? highlight
                ? 'var(--noxa-status-success)'
                : 'var(--noxa-text-faint)'
              : 'var(--noxa-accent-primary-ink)',
          }}
        >
          {isWaiting
            ? `待機 ${cast.waitMin}分`
            : `接客中 · ${tableLabel ?? ''}`}
        </span>
      </div>

      {/* 次候補バッジ */}
      {highlight && (
        <span
          style={{
            fontFamily: mono,
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--noxa-status-success)',
            border: '1px solid rgba(123,232,161,0.35)',
            padding: '2px 7px',
            borderRadius: 9999,
            flex: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          NEXT
        </span>
      )}
    </div>
  );
}

function DetailItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontFamily: 'var(--noxa-font-mono)',
          fontSize: 9,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: 'var(--noxa-text-faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--noxa-font-mono)',
          fontSize: 14,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: highlight ? 'var(--noxa-status-warning)' : 'var(--noxa-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default SeatingClient;
