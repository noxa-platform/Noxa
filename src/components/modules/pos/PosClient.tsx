'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ① POS — オーダーエントリー UI モック（ガワのみ）
 *
 * 決済機能は持たない。卓選択 → メニュー選択 → 注文明細 / 会計伝票出力までの見た目だけ。
 * ロジック・永続化なし。すべて MOCK_* のモックデータ。UI 内部 state（卓選択・カテゴリ
 * タブ）のみ useState で実装。ボタンは no-op。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

type TableStatus = 'empty' | 'occupied' | 'checkout';

type MockTable = {
  id: string;
  name: string;
  status: TableStatus;
  cast?: string; // 接客中キャスト
  guests?: number; // 来店人数
  elapsed?: string; // 経過時間
};

const MOCK_TABLES: MockTable[] = [
  { id: 'T1', name: '卓1', status: 'occupied', cast: '玲奈', guests: 2, elapsed: '42分' },
  { id: 'T2', name: '卓2', status: 'empty' },
  { id: 'T3', name: '卓3', status: 'checkout', cast: '美咲', guests: 3, elapsed: '1:18' },
  { id: 'T4', name: '卓4', status: 'occupied', cast: 'ひかり', guests: 1, elapsed: '12分' },
  { id: 'T5', name: '卓5', status: 'empty' },
  { id: 'T6', name: '卓6', status: 'occupied', cast: 'さくら', guests: 4, elapsed: '55分' },
  { id: 'T7', name: '卓7', status: 'checkout', cast: 'ゆい', guests: 2, elapsed: '2:03' },
  { id: 'T8', name: '卓8', status: 'empty' },
];

type MenuCategory = 'food' | 'drink' | 'bottle' | 'service' | 'set';

const CATEGORY_TABS: { id: MenuCategory; label: string }[] = [
  { id: 'food', label: 'フード' },
  { id: 'drink', label: 'ドリンク' },
  { id: 'bottle', label: 'ボトル' },
  { id: 'service', label: 'サービス' },
  { id: 'set', label: 'セット' },
];

type MockMenuItem = { name: string; price: number; note?: string };

const MOCK_MENU: Record<MenuCategory, MockMenuItem[]> = {
  food: [
    { name: '枝豆', price: 600 },
    { name: 'ミックスナッツ', price: 800 },
    { name: 'チーズ盛り合わせ', price: 1500 },
    { name: '生ハム', price: 1800 },
    { name: 'フルーツ盛り', price: 3500 },
    { name: '特製カレー', price: 1200 },
  ],
  drink: [
    { name: 'ハイボール', price: 900 },
    { name: '生ビール', price: 1000 },
    { name: 'カシスオレンジ', price: 1000 },
    { name: 'ジントニック', price: 1100 },
    { name: 'ウーロン茶', price: 600 },
    { name: 'シャンパングラス', price: 2000 },
  ],
  bottle: [
    { name: '鏡月 ボトル', price: 12000 },
    { name: 'モエ ロゼ', price: 30000 },
    { name: 'ヴーヴ・クリコ', price: 45000 },
    { name: 'ドンペリ 白', price: 80000 },
  ],
  service: [
    { name: '指名', price: 3000 },
    { name: '同伴', price: 5000 },
    { name: '場内指名', price: 2000 },
  ],
  set: [
    { name: 'セット 60分', price: 5000 },
    { name: '延長 30分', price: 3000 },
    { name: 'VIP ルーム', price: 10000 },
  ],
};

type MockOrderLine = { name: string; qty: number; price: number };

// 選択中の卓（T1）の現在の注文明細
const MOCK_ORDER: MockOrderLine[] = [
  { name: '指名（玲奈）', qty: 1, price: 3000 },
  { name: 'セット 60分', qty: 2, price: 5000 },
  { name: 'ハイボール', qty: 4, price: 900 },
  { name: 'ドンペリ 白', qty: 1, price: 80000 },
];

const SERVICE_RATE = 0.15; // サービス料 15%

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

const STATUS_META: Record<TableStatus, { label: string; color: string }> = {
  empty: { label: '空席', color: 'var(--noxa-text-faint)' },
  occupied: { label: '接客中', color: 'var(--noxa-accent-primary-ink)' },
  checkout: { label: '会計待ち', color: 'var(--noxa-status-warning)' },
};

const mono = 'var(--noxa-font-mono)';

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function PosClient() {
  const [selectedTable, setSelectedTable] = useState<string>('T1');
  const [activeCategory, setActiveCategory] = useState<MenuCategory>('drink');

  const current = MOCK_TABLES.find((t) => t.id === selectedTable);
  const subtotal = MOCK_ORDER.reduce((sum, l) => sum + l.qty * l.price, 0);
  const serviceCharge = Math.round(subtotal * SERVICE_RATE);
  const total = subtotal + serviceCharge;

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
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.12) 0%, transparent 65%)',
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
              <li>pos</li>
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
                Noxa OS · Module 01 · Order Entry
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
                  № 01
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  POS · オーダー
                </span>
              </h1>
            </div>

            {/* 決済なしを明示するバッジ */}
            <div
              role="note"
              aria-label="このモジュールは決済機能を持ちません"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(184, 156, 251, 0.10)',
                border: '1px solid var(--noxa-divider)',
                borderRadius: 9999,
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--noxa-text-muted)',
                textTransform: 'uppercase',
              }}
            >
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-accent-primary-ink)' }}
              />
              決済なし · 伝票出力まで
            </div>
          </div>
        </header>

        {/* ─ 3ペイン ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[180px_1fr_330px]"
          style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}
        >
          {/* 左：卓選択 */}
          <section aria-label="卓選択">
            <PaneTitle>卓選択</PaneTitle>
            <div className="grid grid-cols-4 lg:grid-cols-2" style={{ gap: 8 }}>
              {MOCK_TABLES.map((t) => {
                const meta = STATUS_META[t.status];
                const active = t.id === selectedTable;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTable(t.id)}
                    aria-pressed={active}
                    aria-label={`${t.name} ${meta.label}`}
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: 64,
                      padding: '10px 10px',
                      borderRadius: 12,
                      background:
                        t.status === 'empty' ? 'transparent' : 'var(--noxa-surface-card)',
                      border: active
                        ? '1px solid var(--noxa-accent-primary)'
                        : `1px solid ${
                            t.status === 'occupied'
                              ? 'var(--noxa-border-strong)'
                              : t.status === 'checkout'
                                ? 'rgba(245, 212, 114, 0.40)'
                                : 'var(--noxa-border)'
                          }`,
                      boxShadow: active ? 'var(--noxa-glow-ring)' : 'none',
                      transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      color: 'var(--noxa-text-primary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                      <span
                        aria-hidden
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          background: meta.color,
                          boxShadow:
                            t.status !== 'empty' ? `0 0 8px ${meta.color}` : 'none',
                          flex: 'none',
                        }}
                      />
                    </span>
                    <span style={{ fontSize: 10, color: meta.color, fontFamily: mono }}>
                      {meta.label}
                    </span>
                    {t.cast && (
                      <span style={{ fontSize: 11, color: 'var(--noxa-text-muted)' }}>
                        {t.cast} · {t.guests}名
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 中央：メニュー */}
          <section aria-label="メニュー">
            <PaneTitle>メニュー</PaneTitle>

            {/* カテゴリタブ */}
            <div
              role="tablist"
              aria-label="メニューカテゴリ"
              style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                paddingBottom: 4,
                marginBottom: 12,
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

            {/* メニューカードグリッド */}
            <div
              className="grid grid-cols-2 sm:grid-cols-3"
              style={{ gap: 10 }}
            >
              {MOCK_MENU[activeCategory].map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => {
                    /* ガワのみ：注文追加は no-op */
                  }}
                  aria-label={`${m.name} ${yen(m.price)} を注文に追加`}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    minHeight: 76,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'var(--noxa-surface-card)',
                    border: '1px solid var(--noxa-border)',
                    color: 'var(--noxa-text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 8,
                    transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>{m.name}</span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 14,
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--noxa-accent-primary-ink)',
                    }}
                  >
                    {yen(m.price)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 右：現在の注文 + 伝票 */}
          <section aria-label="現在の注文">
            <PaneTitle>
              現在の注文
              <span style={{ color: 'var(--noxa-text-muted)', fontWeight: 400, marginLeft: 8 }}>
                {current?.name}
                {current?.cast ? ` · ${current.cast}` : ''}
              </span>
            </PaneTitle>

            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {/* 卓ヘッダー */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottom: '1px solid var(--noxa-divider)',
                }}
              >
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 18, fontWeight: 500 }}>
                  {current?.name ?? '—'}
                </span>
                {current?.elapsed && (
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>
                    経過 {current.elapsed}
                  </span>
                )}
              </div>

              {/* 明細 */}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {MOCK_ORDER.map((l, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      alignItems: 'baseline',
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--noxa-text-primary)' }}>{l.name}</span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 12,
                        color: 'var(--noxa-text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      ×{l.qty}
                    </span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--noxa-text-primary)',
                        minWidth: 72,
                        textAlign: 'right',
                      }}
                    >
                      {yen(l.qty * l.price)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* 合計 */}
              <div
                style={{
                  borderTop: '1px solid var(--noxa-divider)',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <TotalRow label="小計" value={yen(subtotal)} />
                <TotalRow label={`サービス料（${Math.round(SERVICE_RATE * 100)}%）`} value={yen(serviceCharge)} />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    paddingTop: 10,
                    borderTop: '1px solid var(--noxa-border-strong)',
                  }}
                >
                  <span
                    style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)' }}
                  >
                    合計
                  </span>
                  <span
                    className="noxa-display"
                    style={{
                      fontFamily: 'var(--noxa-font-display-en)',
                      fontSize: 30,
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--noxa-text-primary)',
                    }}
                  >
                    {yen(total)}
                  </span>
                </div>
              </div>

              {/* アクション */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    /* no-op: ガワのみ。実装時に伝票生成 */
                  }}
                  className="noxa-btn noxa-btn-primary"
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    minHeight: 48,
                    borderRadius: 12,
                    border: '1px solid var(--noxa-accent-primary)',
                    background: 'var(--noxa-accent-primary)',
                    color: '#fff',
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 15,
                    fontWeight: 600,
                    boxShadow: 'var(--noxa-glow-soft)',
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  会計伝票を出力
                </button>
                <button
                  type="button"
                  onClick={() => {
                    /* no-op: ガワのみ */
                  }}
                  className="noxa-btn noxa-btn-secondary"
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    minHeight: 48,
                    borderRadius: 12,
                    border: '1px solid var(--noxa-border-strong)',
                    background: 'var(--noxa-surface-muted)',
                    color: 'var(--noxa-text-primary)',
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 14,
                    fontWeight: 500,
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  卓を締める
                </button>
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--noxa-text-faint)',
                  fontFamily: mono,
                }}
              >
                ※ 決済は既存レジ運用。Noxa POS は伝票出力 → ② 売上管理へ自動転記。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

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

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--noxa-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default PosClient;
