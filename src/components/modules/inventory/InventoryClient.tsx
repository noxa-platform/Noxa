'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ⑧ 在庫管理 — UI モック（ガワのみ）
 *
 * ロジック・永続化なし。すべて MOCK_* のモックデータ。
 * UI 内部 state（カテゴリフィルタ）のみ useState で実装。ボタンは no-op。
 */

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

type ItemCategory = 'bottle' | 'food' | 'supply';
type StockStatus = 'ok' | 'low' | 'out';

type MockStockItem = {
  id: string;
  name: string;
  category: ItemCategory;
  stock: number;
  threshold: number;
  unit: string;
};

type MockBottleKeep = {
  id: string;
  guestName: string;
  brand: string;
  keepDate: string;   // YYYY-MM-DD
  expiry: string;     // YYYY-MM-DD
  remaining: number;  // 0-100 %
  nearExpiry: boolean;
};

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

const MOCK_STOCK: MockStockItem[] = [
  // ボトル
  { id: 'b1', name: '鏡月（ボトル）', category: 'bottle', stock: 8, threshold: 6, unit: '本' },
  { id: 'b2', name: 'モエ ロゼ', category: 'bottle', stock: 2, threshold: 4, unit: '本' },      // 閾値割れ
  { id: 'b3', name: 'ドンペリ 白', category: 'bottle', stock: 1, threshold: 2, unit: '本' },      // 閾値割れ
  { id: 'b4', name: 'ヴーヴ・クリコ', category: 'bottle', stock: 0, threshold: 2, unit: '本' }, // 在庫切れ
  { id: 'b5', name: 'ジャックダニエル', category: 'bottle', stock: 5, threshold: 3, unit: '本' },
  // 食材
  { id: 'f1', name: '枝豆（冷凍）', category: 'food', stock: 3, threshold: 5, unit: 'kg' },      // 閾値割れ
  { id: 'f2', name: 'ミックスナッツ', category: 'food', stock: 12, threshold: 6, unit: '袋' },
  { id: 'f3', name: 'チーズ盛り合わせ', category: 'food', stock: 4, threshold: 4, unit: '食分' },
  { id: 'f4', name: '生ハム', category: 'food', stock: 6, threshold: 3, unit: 'パック' },
  { id: 'f5', name: 'フルーツ盛り', category: 'food', stock: 2, threshold: 3, unit: '食分' },    // 閾値割れ（5品目）
  // 消耗品
  { id: 's1', name: 'グラス（ロング）', category: 'supply', stock: 24, threshold: 12, unit: '個' },
  { id: 's2', name: 'ストロー', category: 'supply', stock: 50, threshold: 100, unit: '本' },      // 閾値割れ（6品目）— ただし表示は warning
  { id: 's3', name: 'おしぼり', category: 'supply', stock: 80, threshold: 50, unit: '枚' },
  { id: 's4', name: 'ナプキン', category: 'supply', stock: 120, threshold: 60, unit: '枚' },
  { id: 's5', name: 'コースター', category: 'supply', stock: 45, threshold: 30, unit: '枚' },
];

const MOCK_BOTTLE_KEEPS: MockBottleKeep[] = [
  { id: 'k1', guestName: '田中 拓海', brand: '鏡月', keepDate: '2026-05-10', expiry: '2026-06-10', remaining: 65, nearExpiry: false },
  { id: 'k2', guestName: '山本 健太', brand: 'ドンペリ 白', keepDate: '2026-04-20', expiry: '2026-06-05', remaining: 30, nearExpiry: true },
  { id: 'k3', guestName: '佐藤 翔', brand: 'ジャックダニエル', keepDate: '2026-05-01', expiry: '2026-07-01', remaining: 80, nearExpiry: false },
  { id: 'k4', guestName: '鈴木 大輔', brand: 'モエ ロゼ', keepDate: '2026-05-20', expiry: '2026-06-20', remaining: 50, nearExpiry: false },
  { id: 'k5', guestName: '伊藤 誠', brand: 'ヴーヴ・クリコ', keepDate: '2026-04-15', expiry: '2026-06-04', remaining: 20, nearExpiry: true },
  { id: 'k6', guestName: '渡辺 龍', brand: '鏡月', keepDate: '2026-05-25', expiry: '2026-07-25', remaining: 90, nearExpiry: false },
  { id: 'k7', guestName: '中村 勇', brand: 'ジャックダニエル', keepDate: '2026-05-18', expiry: '2026-08-18', remaining: 70, nearExpiry: false },
  { id: 'k8', guestName: '小林 悟', brand: '鏡月', keepDate: '2026-05-08', expiry: '2026-07-08', remaining: 55, nearExpiry: false },
];

const CATEGORY_TABS: { id: ItemCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'bottle', label: 'ボトル' },
  { id: 'food', label: '食材' },
  { id: 'supply', label: '消耗品' },
];

const CATEGORY_LABEL: Record<ItemCategory, string> = {
  bottle: 'ボトル',
  food: '食材',
  supply: '消耗品',
};

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

function getStockStatus(item: MockStockItem): StockStatus {
  if (item.stock === 0) return 'out';
  if (item.stock < item.threshold) return 'low';
  return 'ok';
}

const STATUS_META: Record<StockStatus, { label: string; color: string; bgAlpha: string }> = {
  ok:  { label: '十分',   color: 'var(--noxa-status-success)', bgAlpha: 'rgba(123, 232, 161, 0.10)' },
  low: { label: '少ない', color: 'var(--noxa-status-warning)', bgAlpha: 'rgba(245, 212, 114, 0.10)' },
  out: { label: '切れ',   color: 'var(--noxa-status-error)',   bgAlpha: 'rgba(196,  56,  74, 0.10)' },
};

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function InventoryClient() {
  const [activeCategory, setActiveCategory] = useState<ItemCategory | 'all'>('all');

  // 発注アラート対象（閾値割れ）
  const alertItems = MOCK_STOCK.filter((i) => getStockStatus(i) !== 'ok');

  // カテゴリフィルタ適用済みリスト
  const filteredStock =
    activeCategory === 'all'
      ? MOCK_STOCK
      : MOCK_STOCK.filter((i) => i.category === activeCategory);

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
          height: 380,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ header ─ */}
        <header style={{ marginBottom: 24 }}>
          {/* パンくず */}
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
              <li>inventory</li>
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
                Noxa OS · Module 08 · Inventory
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
                  № 08
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  在庫
                </span>
              </h1>
            </div>

            {/* 発注アラート件数バッジ */}
            {alertItems.length > 0 && (
              <div
                role="status"
                aria-live="polite"
                aria-label={`発注アラート ${alertItems.length} 件`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  background: 'rgba(196, 56, 74, 0.12)',
                  border: '1px solid rgba(196, 56, 74, 0.40)',
                  borderRadius: 9999,
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-status-error)',
                  textTransform: 'uppercase',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--noxa-status-error)',
                    boxShadow: '0 0 8px var(--noxa-status-error)',
                  }}
                />
                発注アラート · {alertItems.length} 件
              </div>
            )}
          </div>
        </header>

        {/* ─ セクション 1: 発注アラート ─ */}
        <section aria-label="発注アラート" style={{ marginBottom: 32 }}>
          <SectionTitle>発注アラート</SectionTitle>

          {alertItems.length === 0 ? (
            <p style={{ color: 'var(--noxa-text-faint)', fontFamily: mono, fontSize: 13 }}>
              閾値割れ品なし
            </p>
          ) : (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ gap: 10 }}
            >
              {alertItems.map((item) => {
                const st = getStockStatus(item);
                const meta = STATUS_META[st];
                return (
                  <div
                    key={item.id}
                    role="alert"
                    style={{
                      background: meta.bgAlpha,
                      border: `1px solid ${meta.color}40`,
                      borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 12,
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* 品名 + ステータスドット */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--noxa-text-primary)' }}>
                        {item.name}
                      </span>
                      <StatusBadge status={st} />
                    </div>

                    {/* 在庫数 / 閾値 */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <span style={{ color: 'var(--noxa-text-muted)' }}>
                        在庫{' '}
                        <span
                          style={{
                            fontFamily: mono,
                            fontVariantNumeric: 'tabular-nums',
                            color: meta.color,
                            fontWeight: 700,
                          }}
                        >
                          {item.stock}
                        </span>
                        {' '}{item.unit}
                      </span>
                      <span style={{ color: 'var(--noxa-text-faint)' }}>
                        閾値{' '}
                        <span style={{ fontFamily: mono, fontVariantNumeric: 'tabular-nums' }}>
                          {item.threshold}
                        </span>
                        {' '}{item.unit}
                      </span>
                    </div>

                    {/* 発注ボタン no-op */}
                    <button
                      type="button"
                      onClick={() => { /* no-op: ガワのみ */ }}
                      aria-label={`${item.name} を発注する`}
                      style={{
                        appearance: 'none',
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                        minHeight: 32,
                        padding: '5px 14px',
                        borderRadius: 8,
                        border: `1px solid ${meta.color}80`,
                        background: `${meta.color}18`,
                        color: meta.color,
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 12,
                        fontWeight: 600,
                        transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                    >
                      発注
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ─ セクション 2: 在庫リストテーブル ─ */}
        <section aria-label="在庫一覧" style={{ marginBottom: 32 }}>
          <SectionTitle>在庫一覧</SectionTitle>

          {/* カテゴリフィルタタブ */}
          <div
            role="tablist"
            aria-label="在庫カテゴリ"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 4,
              marginBottom: 16,
            }}
          >
            {CATEGORY_TABS.map((c) => {
              const active = c.id === activeCategory;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(c.id)}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    minHeight: 36,
                    padding: '7px 16px',
                    borderRadius: 9999,
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
                    color: active ? '#fff' : 'var(--noxa-text-muted)',
                    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
                    boxShadow: active ? 'var(--noxa-glow-soft)' : 'none',
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* テーブル（375px で横スクロール） */}
          <div
            style={{
              overflowX: 'auto',
              borderRadius: 14,
              border: '1px solid var(--noxa-border)',
              background: 'var(--noxa-surface-card)',
            }}
          >
            <table
              style={{
                width: '100%',
                minWidth: 520,
                borderCollapse: 'collapse',
                fontFamily: 'var(--noxa-font-sans-jp)',
                fontSize: 13,
              }}
              aria-label="在庫テーブル"
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--noxa-divider)',
                    textAlign: 'left',
                  }}
                >
                  {['品名', 'カテゴリ', '在庫数', '閾値', '状態'].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '11px 16px',
                        fontFamily: mono,
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--noxa-text-faint)',
                        whiteSpace: 'nowrap',
                        textAlign: i >= 2 && i <= 3 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStock.map((item, idx) => {
                  const st = getStockStatus(item);
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom:
                          idx < filteredStock.length - 1
                            ? '1px solid var(--noxa-divider)'
                            : 'none',
                        background:
                          st === 'out'
                            ? 'rgba(196, 56, 74, 0.04)'
                            : st === 'low'
                              ? 'rgba(245, 212, 114, 0.03)'
                              : 'transparent',
                        transition: 'background var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: 'var(--noxa-text-primary)', fontWeight: 500 }}>
                        {item.name}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--noxa-text-muted)' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '3px 10px',
                            borderRadius: 6,
                            background: 'var(--noxa-surface-muted)',
                            fontSize: 11,
                            fontFamily: mono,
                          }}
                        >
                          {CATEGORY_LABEL[item.category]}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontFamily: mono,
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: 14,
                          fontWeight: 700,
                          color:
                            st === 'out'
                              ? 'var(--noxa-status-error)'
                              : st === 'low'
                                ? 'var(--noxa-status-warning)'
                                : 'var(--noxa-text-primary)',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.stock} {item.unit}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontFamily: mono,
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: 13,
                          color: 'var(--noxa-text-faint)',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.threshold} {item.unit}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge status={st} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─ セクション 3: ボトルキープ一覧 ─ */}
        <section aria-label="ボトルキープ一覧">
          <SectionTitle>ボトルキープ一覧</SectionTitle>

          <div
            style={{
              overflowX: 'auto',
              borderRadius: 14,
              border: '1px solid var(--noxa-border)',
              background: 'var(--noxa-surface-card)',
            }}
          >
            <table
              style={{
                width: '100%',
                minWidth: 600,
                borderCollapse: 'collapse',
                fontFamily: 'var(--noxa-font-sans-jp)',
                fontSize: 13,
              }}
              aria-label="ボトルキープテーブル"
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--noxa-divider)', textAlign: 'left' }}>
                  {['客名', '銘柄', 'キープ日', '期限', '残量'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '11px 16px',
                        fontFamily: mono,
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--noxa-text-faint)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_BOTTLE_KEEPS.map((k, idx) => (
                  <tr
                    key={k.id}
                    style={{
                      borderBottom:
                        idx < MOCK_BOTTLE_KEEPS.length - 1
                          ? '1px solid var(--noxa-divider)'
                          : 'none',
                      background: k.nearExpiry
                        ? 'rgba(245, 212, 114, 0.04)'
                        : 'transparent',
                    }}
                  >
                    {/* 客名 */}
                    <td
                      style={{
                        padding: '12px 16px',
                        color: 'var(--noxa-text-primary)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {k.nearExpiry && (
                          <span
                            aria-hidden
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              background: 'var(--noxa-status-warning)',
                              boxShadow: '0 0 6px var(--noxa-status-warning)',
                              flex: 'none',
                            }}
                          />
                        )}
                        {k.guestName}
                      </div>
                    </td>
                    {/* 銘柄 */}
                    <td style={{ padding: '12px 16px', color: 'var(--noxa-text-muted)' }}>
                      {k.brand}
                    </td>
                    {/* キープ日 */}
                    <td
                      style={{
                        padding: '12px 16px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: 'var(--noxa-text-faint)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {k.keepDate}
                    </td>
                    {/* 期限 */}
                    <td
                      style={{
                        padding: '12px 16px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: k.nearExpiry ? 'var(--noxa-status-warning)' : 'var(--noxa-text-muted)',
                        fontWeight: k.nearExpiry ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {k.expiry}
                      {k.nearExpiry && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            letterSpacing: '0.06em',
                            color: 'var(--noxa-status-warning)',
                          }}
                        >
                          期限間近
                        </span>
                      )}
                    </td>
                    {/* 残量バー */}
                    <td style={{ padding: '12px 16px', minWidth: 120 }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                        aria-label={`残量 ${k.remaining}%`}
                      >
                        {/* プログレスバー */}
                        <div
                          aria-hidden
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background: 'var(--noxa-surface-muted)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${k.remaining}%`,
                              borderRadius: 3,
                              background:
                                k.remaining <= 30
                                  ? 'var(--noxa-status-warning)'
                                  : 'var(--noxa-accent-primary-ink)',
                              transition: 'width var(--noxa-duration-fast) var(--noxa-ease-natural)',
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 12,
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              k.remaining <= 30
                                ? 'var(--noxa-status-warning)'
                                : 'var(--noxa-text-muted)',
                            flex: 'none',
                            minWidth: 32,
                            textAlign: 'right',
                          }}
                        >
                          {k.remaining}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 期限間近の注意書き */}
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
              lineHeight: 1.6,
            }}
          >
            ※ 黄色のドット = 期限まで 7 日以内。ボトルキープの自動アラートは v1.5 で実装予定。
          </p>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 小コンポーネント
// ─────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="noxa-eyebrow"
      style={{ fontSize: 11, marginBottom: 14, display: 'block' }}
    >
      {children}
    </h2>
  );
}

/** ステータスドット + テキスト（PosClient のステータスドット表現踏襲） */
function StatusBadge({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 9999,
        background: meta.bgAlpha,
        border: `1px solid ${meta.color}40`,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: meta.color,
          boxShadow: status !== 'ok' ? `0 0 7px ${meta.color}` : 'none',
          flex: 'none',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--noxa-font-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.06em',
          color: meta.color,
        }}
      >
        {meta.label}
      </span>
    </span>
  );
}

export default InventoryClient;
