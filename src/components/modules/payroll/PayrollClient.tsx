'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ⑤ 給与計算 — Payroll UI モック（ガワのみ）
 *
 * 計算ロジックなし。モックデータを確定値として表示。
 * セレクト（月・キャスト）は useState で見た目のみ切り替え。
 * ボタン類はすべて no-op。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

const MOCK_MONTHS = ['2026年6月', '2026年5月', '2026年4月', '2026年3月'];

type MockCast = { id: string; name: string };
const MOCK_CASTS: MockCast[] = [
  { id: 'reina', name: '玲奈' },
  { id: 'misaki', name: '美咲' },
  { id: 'hikari', name: 'ひかり' },
  { id: 'sakura', name: 'さくら' },
  { id: 'yui', name: 'ゆい' },
  { id: 'mana', name: '真奈' },
];

/** 給与明細 内訳行 */
type PayrollLine = {
  label: string;
  amount: number;
  type: 'add' | 'deduct';
  note?: string;
};

const MOCK_DETAIL_LINES: PayrollLine[] = [
  // 加算
  { label: '売上歩合（売上 ¥1,050,000 × 40%）', amount: 420_000, type: 'add' },
  { label: '時給（96h × ¥1,000）', amount: 96_000, type: 'add' },
  { label: '同伴バック（6件 × ¥5,000）', amount: 30_000, type: 'add' },
  { label: '指名バック（12件 × ¥1,500）', amount: 18_000, type: 'add' },
  { label: 'アフターバック（3件 × ¥3,000）', amount: 9_000, type: 'add' },
  // 減算
  { label: '遅刻罰金（2回）', amount: -3_000, type: 'deduct' },
  { label: '欠勤罰金（1回）', amount: -2_000, type: 'deduct' },
  { label: '立替・前借り精算', amount: -27_000, type: 'deduct' },
];

const MOCK_NET_PAY = 541_000;

/** 月締めスタッフテーブル */
type StaffRow = {
  name: string;
  gross: number;
  deductions: number;
  net: number;
};

const MOCK_STAFF_ROWS: StaffRow[] = [
  { name: '玲奈', gross: 573_000, deductions: 32_000, net: 541_000 },
  { name: '美咲', gross: 418_000, deductions: 12_000, net: 406_000 },
  { name: 'ひかり', gross: 285_000, deductions: 5_000, net: 280_000 },
  { name: 'さくら', gross: 362_000, deductions: 18_000, net: 344_000 },
  { name: 'ゆい', gross: 210_000, deductions: 3_000, net: 207_000 },
  { name: '真奈', gross: 156_000, deductions: 2_000, net: 154_000 },
];

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const yen = (n: number) => `¥${Math.abs(n).toLocaleString('ja-JP')}`;

const mono = 'var(--noxa-font-mono)';

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function PayrollClient() {
  const [selectedMonth, setSelectedMonth] = useState(MOCK_MONTHS[1]); // 5月をデフォルト
  const [selectedCast, setSelectedCast] = useState(MOCK_CASTS[0].id);

  const castName = MOCK_CASTS.find((c) => c.id === selectedCast)?.name ?? '—';

  // 合計行
  const totalGross = MOCK_STAFF_ROWS.reduce((s, r) => s + r.gross, 0);
  const totalDeductions = MOCK_STAFF_ROWS.reduce((s, r) => s + r.deductions, 0);
  const totalNet = MOCK_STAFF_ROWS.reduce((s, r) => s + r.net, 0);

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
      {/* ambient glow — cyan-mist (info) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-25%',
          right: '-12%',
          width: 720,
          height: 440,
          background:
            'radial-gradient(ellipse, rgba(103, 232, 249, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      {/* purple secondary glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-20%',
          left: '-8%',
          width: 500,
          height: 320,
          background:
            'radial-gradient(ellipse, rgba(139, 92, 246, 0.08) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ ヘッダー ─ */}
        <header style={{ marginBottom: 24 }}>
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
                <Link
                  href="/"
                  style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}
                >
                  Noxa OS
                </Link>
              </li>
              <li aria-hidden>·</li>
              <li>payroll</li>
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
                Noxa OS · Module 05 · Payroll
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
                    color: 'var(--noxa-status-info)',
                    fontWeight: 400,
                    textShadow: '0 0 28px rgba(103,232,249,0.40)',
                  }}
                >
                  № 05
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  給与
                </span>
              </h1>
            </div>

            {/* モックバッジ */}
            <div
              role="note"
              aria-label="モックデータ表示中"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(103, 232, 249, 0.08)',
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
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--noxa-status-info)',
                  boxShadow: '0 0 8px var(--noxa-status-info)',
                }}
              />
              Mock · 計算ロジック未実装
            </div>
          </div>
        </header>

        {/* ─ コントロールバー ─ */}
        <section
          aria-label="対象絞り込み"
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 24,
            padding: '14px 16px',
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 14,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.1em',
              color: 'var(--noxa-text-faint)',
              textTransform: 'uppercase',
            }}
          >
            対象
          </span>

          {/* 月セレクト */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--noxa-text-faint)',
              }}
            >
              月
            </span>
            <select
              aria-label="対象月"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                minHeight: 44,
                padding: '0 36px 0 14px',
                borderRadius: 10,
                background: 'var(--noxa-surface-muted)',
                border: '1px solid var(--noxa-border-strong)',
                color: 'var(--noxa-text-primary)',
                fontFamily: 'var(--noxa-font-sans-jp)',
                fontSize: 14,
                fontWeight: 500,
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6680' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                outline: 'none',
              }}
            >
              {MOCK_MONTHS.map((m) => (
                <option key={m} value={m}
                  style={{ background: '#1A1228', color: 'var(--noxa-text-primary)' }}
                >
                  {m}
                </option>
              ))}
            </select>
          </label>

          {/* キャストセレクト */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--noxa-text-faint)',
              }}
            >
              キャスト
            </span>
            <select
              aria-label="対象キャスト"
              value={selectedCast}
              onChange={(e) => setSelectedCast(e.target.value)}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                minHeight: 44,
                padding: '0 36px 0 14px',
                borderRadius: 10,
                background: 'var(--noxa-surface-muted)',
                border: '1px solid var(--noxa-border-strong)',
                color: 'var(--noxa-text-primary)',
                fontFamily: 'var(--noxa-font-sans-jp)',
                fontSize: 14,
                fontWeight: 500,
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6680' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                outline: 'none',
              }}
            >
              {MOCK_CASTS.map((c) => (
                <option key={c.id} value={c.id}
                  style={{ background: '#1A1228', color: 'var(--noxa-text-primary)' }}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* ─ 2カラムレイアウト（明細 + サマリ） ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_320px]"
          style={{ gap: 'clamp(14px, 2vw, 20px)', alignItems: 'start', marginBottom: 32 }}
        >
          {/* 左：給与明細カード */}
          <section
            aria-label={`${castName}の給与明細`}
            style={{
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 16,
              padding: 'clamp(16px, 2vw, 24px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}
          >
            {/* 明細ヘッダー */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 16,
                borderBottom: '1px solid var(--noxa-divider)',
                marginBottom: 20,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--noxa-text-faint)',
                    textTransform: 'uppercase',
                    marginBottom: 4,
                  }}
                >
                  給与明細
                </div>
                <div
                  style={{
                    fontFamily: 'var(--noxa-font-display-jp)',
                    fontSize: 22,
                    fontWeight: 600,
                    color: 'var(--noxa-text-primary)',
                  }}
                >
                  {castName}
                </div>
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  color: 'var(--noxa-text-muted)',
                  letterSpacing: '0.06em',
                }}
              >
                {selectedMonth}
              </div>
            </div>

            {/* 加算項目 */}
            <SectionLabel>加算</SectionLabel>
            <ul
              style={{
                listStyle: 'none',
                margin: '8px 0 20px',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {MOCK_DETAIL_LINES.filter((l) => l.type === 'add').map((l, i) => (
                <DetailLine key={i} line={l} />
              ))}
            </ul>

            <div style={{ borderTop: '1px solid var(--noxa-divider)', marginBottom: 20 }} />

            {/* 減算項目 */}
            <SectionLabel>減算</SectionLabel>
            <ul
              style={{
                listStyle: 'none',
                margin: '8px 0 24px',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {MOCK_DETAIL_LINES.filter((l) => l.type === 'deduct').map((l, i) => (
                <DetailLine key={i} line={l} />
              ))}
            </ul>

            {/* 差引支給額 */}
            <div
              style={{
                borderTop: '1px solid var(--noxa-border-strong)',
                paddingTop: 20,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-muted)',
                  }}
                >
                  差引支給額
                </span>
                <span
                  className="noxa-display"
                  style={{
                    fontFamily: 'var(--noxa-font-display-en)',
                    fontSize: 'clamp(34px, 5vw, 48px)',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '-0.01em',
                    color: 'var(--noxa-status-info)',
                    textShadow:
                      '0 0 32px rgba(103,232,249,0.55), 0 0 60px rgba(103,232,249,0.25)',
                  }}
                >
                  ¥{MOCK_NET_PAY.toLocaleString('ja-JP')}
                </span>
              </div>
            </div>
          </section>

          {/* 右：内訳サマリ（スティッキー） */}
          <aside
            aria-label="支給内訳サマリ"
            style={{
              position: 'sticky',
              top: 16,
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 16,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--noxa-text-faint)',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              内訳サマリ
            </div>

            <SummaryRow
              label="総加算"
              value={yen(
                MOCK_DETAIL_LINES.filter((l) => l.type === 'add').reduce(
                  (s, l) => s + l.amount,
                  0,
                ),
              )}
              color="var(--noxa-status-success)"
            />
            <SummaryRow
              label="総控除"
              value={`-${yen(
                MOCK_DETAIL_LINES.filter((l) => l.type === 'deduct').reduce(
                  (s, l) => s + l.amount,
                  0,
                ),
              )}`}
              color="var(--noxa-status-error)"
            />

            <div
              style={{
                borderTop: '1px solid var(--noxa-divider)',
                paddingTop: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-muted)',
                  }}
                >
                  差引
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 24,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--noxa-status-info)',
                    textShadow: '0 0 20px rgba(103,232,249,0.40)',
                  }}
                >
                  ¥{MOCK_NET_PAY.toLocaleString('ja-JP')}
                </span>
              </div>
            </div>

            {/* 歩合率インジケーター */}
            <div
              style={{
                marginTop: 4,
                padding: '12px 14px',
                background: 'rgba(103, 232, 249, 0.07)',
                border: '1px solid rgba(103, 232, 249, 0.18)',
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--noxa-text-faint)',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                売上歩合率
              </div>
              <div
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontSize: 28,
                  fontWeight: 600,
                  color: 'var(--noxa-status-info)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                40<span style={{ fontSize: 16, fontWeight: 400, marginLeft: 2 }}>%</span>
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: 'var(--noxa-text-faint)',
                  marginTop: 4,
                }}
              >
                対象売上 ¥1,050,000
              </div>
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
              ※ 確定値はモック。実装時は ② 売上管理 + ④ 勤怠から自動取得。
            </p>
          </aside>
        </div>

        {/* ─ 全スタッフ月締めテーブル ─ */}
        <section aria-label="全スタッフ月締め">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 14,
            }}
          >
            <h2
              className="noxa-eyebrow"
              style={{ fontSize: 11, margin: 0, display: 'block' }}
            >
              全スタッフ月締め · {selectedMonth}
            </h2>

            {/* アクションボタン */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  /* no-op: PDF出力 */
                }}
                aria-label="PDF出力（未実装）"
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: 10,
                  background: 'var(--noxa-surface-card)',
                  border: '1px solid var(--noxa-border-strong)',
                  color: 'var(--noxa-text-primary)',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                }}
              >
                <PdfIcon />
                PDF 出力
              </button>
              <button
                type="button"
                onClick={() => {
                  /* no-op: 振込データ出力 */
                }}
                aria-label="振込データ出力（未実装）"
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: 10,
                  background: 'rgba(103, 232, 249, 0.10)',
                  border: '1px solid rgba(103, 232, 249, 0.30)',
                  color: 'var(--noxa-status-info)',
                  fontFamily: 'var(--noxa-font-sans-jp)',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                }}
              >
                <BankIcon />
                振込データ出力
              </button>
            </div>
          </div>

          {/* テーブル（横スクロール対応） */}
          <div
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              borderRadius: 14,
              border: '1px solid var(--noxa-border)',
            }}
          >
            <table
              style={{
                width: '100%',
                minWidth: 480,
                borderCollapse: 'collapse',
                fontFamily: 'var(--noxa-font-sans-jp)',
                fontSize: 14,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--noxa-surface-card)',
                    borderBottom: '1px solid var(--noxa-border-strong)',
                  }}
                >
                  {['キャスト', '総支給', '控除合計', '差引支給額'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '12px 16px',
                        textAlign: h === 'キャスト' ? 'left' : 'right',
                        fontFamily: mono,
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: 'var(--noxa-text-faint)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_STAFF_ROWS.map((row, i) => (
                  <tr
                    key={row.name}
                    style={{
                      background:
                        i % 2 === 0 ? 'transparent' : 'rgba(26, 18, 40, 0.40)',
                      borderBottom: '1px solid var(--noxa-divider)',
                    }}
                  >
                    <td
                      style={{
                        padding: '14px 16px',
                        color: 'var(--noxa-text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {row.name}
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        textAlign: 'right',
                        fontFamily: mono,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--noxa-status-success)',
                        fontSize: 14,
                      }}
                    >
                      {yen(row.gross)}
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        textAlign: 'right',
                        fontFamily: mono,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--noxa-status-error)',
                        fontSize: 14,
                      }}
                    >
                      -{yen(row.deductions)}
                    </td>
                    <td
                      style={{
                        padding: '14px 16px',
                        textAlign: 'right',
                        fontFamily: mono,
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--noxa-text-primary)',
                      }}
                    >
                      {yen(row.net)}
                    </td>
                  </tr>
                ))}

                {/* 合計行 */}
                <tr
                  style={{
                    background: 'var(--noxa-surface-card)',
                    borderTop: '1px solid var(--noxa-border-strong)',
                  }}
                >
                  <td
                    style={{
                      padding: '14px 16px',
                      fontFamily: mono,
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: 'var(--noxa-text-muted)',
                    }}
                  >
                    TOTAL
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontFamily: mono,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 15,
                      fontWeight: 700,
                      color: 'var(--noxa-status-success)',
                    }}
                  >
                    {yen(totalGross)}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontFamily: mono,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 15,
                      fontWeight: 700,
                      color: 'var(--noxa-status-error)',
                    }}
                  >
                    -{yen(totalDeductions)}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontFamily: mono,
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 18,
                      fontWeight: 700,
                      color: 'var(--noxa-status-info)',
                      textShadow: '0 0 16px rgba(103,232,249,0.40)',
                    }}
                  >
                    {yen(totalNet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// サブコンポーネント
// ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--noxa-text-faint)',
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function DetailLine({ line }: { line: PayrollLine }) {
  const isDeduct = line.type === 'deduct';
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'baseline',
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: 'var(--noxa-text-muted)',
          lineHeight: 1.4,
        }}
      >
        {line.label}
      </span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 14,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          color: isDeduct ? 'var(--noxa-status-error)' : 'var(--noxa-status-success)',
        }}
      >
        {isDeduct ? '-' : '+'}
        {yen(line.amount)}
      </span>
    </li>
  );
}

function SummaryRow({
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
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 15,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** PDF アイコン（インライン SVG） */
function PdfIcon() {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 9h6M5 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 銀行アイコン（インライン SVG） */
function BankIcon() {
  return (
    <svg
      aria-hidden
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1 6h14M8 2l7 4H1l7-4ZM3 6v6m3-6v6m3-6v6m3-6v6M1 12h14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default PayrollClient;
