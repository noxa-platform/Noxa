'use client';

import Link from 'next/link';

/**
 * 目標管理モジュール — Noxa OS（モック）
 *
 * 今月の目標・実績・達成率、バック内訳、過去6ヶ月の達成率チャートを表示。
 * データはすべてモック値。実装フェーズで Firestore 連携に差し替える。
 */

const mono = 'var(--noxa-font-mono)';
const display = 'var(--noxa-font-display-en)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const pct = (n: number) => `${n}%`;

// ── モックデータ ────────────────────────────────────────────
const GOAL_SALES = 1_500_000;
const ACTUAL_SALES = 1_090_000;
const ACHIEVEMENT_RATE = Math.round((ACTUAL_SALES / GOAL_SALES) * 100);

type BackItem = {
  label: string;
  goal: number;
  actual: number;
  color: string;
};

const BACK_ITEMS: BackItem[] = [
  { label: '指名',   goal: 600_000,  actual: 460_000, color: 'var(--noxa-accent-primary)' },
  { label: '同伴',   goal: 400_000,  actual: 280_000, color: 'var(--noxa-accent-violet)' },
  { label: 'ボトル', goal: 300_000,  actual: 230_000, color: 'var(--noxa-accent-cyan)' },
  { label: 'アフター', goal: 200_000, actual: 120_000, color: 'var(--noxa-accent-amber)' },
];

type MonthStat = { label: string; rate: number };

const MONTHLY_HISTORY: MonthStat[] = [
  { label: '1月', rate: 81 },
  { label: '2月', rate: 68 },
  { label: '3月', rate: 95 },
  { label: '4月', rate: 72 },
  { label: '5月', rate: 88 },
  { label: '6月', rate: 73 },
];

// ── SVG バーチャート ──────────────────────────────────────────
const CHART_W = 320;
const CHART_H = 100;
const BAR_W = 32;
const GAP = (CHART_W - BAR_W * 6) / 7;

function HistoryChart({ data }: { data: MonthStat[] }) {
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H + 24}`}
      width="100%"
      aria-label="過去6ヶ月の達成率チャート"
      role="img"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* グリッドライン 100% / 50% */}
      {[100, 50].map((v) => {
        const y = CHART_H - (v / 100) * CHART_H;
        return (
          <g key={v}>
            <line
              x1={0} y1={y} x2={CHART_W} y2={y}
              stroke="var(--noxa-border)"
              strokeWidth={0.8}
              strokeDasharray="3 3"
            />
            <text
              x={CHART_W + 4} y={y + 4}
              fontSize={9}
              fill="var(--noxa-text-faint)"
              fontFamily={mono}
            >
              {v}%
            </text>
          </g>
        );
      })}

      {/* バー */}
      {data.map((m, i) => {
        const x = GAP + i * (BAR_W + GAP);
        const barH = (m.rate / 100) * CHART_H;
        const y = CHART_H - barH;
        const isCurrent = i === data.length - 1;
        return (
          <g key={m.label}>
            {/* 背景バー */}
            <rect
              x={x} y={0} width={BAR_W} height={CHART_H}
              rx={4}
              fill="var(--noxa-surface-muted)"
            />
            {/* 実績バー */}
            <rect
              x={x} y={y} width={BAR_W} height={barH}
              rx={4}
              fill={
                isCurrent
                  ? 'url(#goalGradCurrent)'
                  : 'var(--noxa-surface-raised)'
              }
              opacity={isCurrent ? 1 : 0.75}
            />
            {/* 達成率ラベル */}
            <text
              x={x + BAR_W / 2} y={y - 5}
              textAnchor="middle"
              fontSize={9}
              fontFamily={mono}
              fill={isCurrent ? 'var(--noxa-accent-violet)' : 'var(--noxa-text-faint)'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {m.rate}%
            </text>
            {/* 月ラベル */}
            <text
              x={x + BAR_W / 2} y={CHART_H + 16}
              textAnchor="middle"
              fontSize={10}
              fontFamily={mono}
              fill={isCurrent ? 'var(--noxa-text-primary)' : 'var(--noxa-text-faint)'}
            >
              {m.label}
            </text>
          </g>
        );
      })}

      {/* グラデーション定義 */}
      <defs>
        <linearGradient id="goalGradCurrent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--noxa-accent-violet)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--noxa-accent-primary)" stopOpacity="0.7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── バック内訳バー ────────────────────────────────────────────
function BackBar({ item }: { item: BackItem }) {
  const actualRate = Math.min(Math.round((item.actual / item.goal) * 100), 100);
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13 }}>{item.label}</span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>
            目標 {yen(item.goal)}
          </span>
          <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--noxa-text-primary)' }}>
            {yen(item.actual)}
          </span>
        </span>
      </div>
      {/* 2段バー：目標背景 + 実績 */}
      <div
        role="progressbar"
        aria-valuenow={actualRate}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${item.label} 達成率 ${actualRate}%`}
        style={{ height: 6, background: 'var(--noxa-surface-muted)', borderRadius: 3, overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${actualRate}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${item.color}, color-mix(in srgb, ${item.color} 60%, var(--noxa-accent-primary-neon)))`,
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', textAlign: 'right' }}>
        {actualRate}%
      </div>
    </li>
  );
}

// ── メインコンポーネント ────────────────────────────────────────
export function GoalsClient() {
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
      {/* 装飾グロー */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-25%',
          right: '-8%',
          width: 600,
          height: 400,
          background: 'radial-gradient(ellipse, rgba(167,139,250,0.10) 0%, transparent 65%)',
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
            <li>goals</li>
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
            marginBottom: 24,
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Goals</div>
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
                  fontFamily: display,
                  fontStyle: 'italic',
                  color: 'var(--noxa-accent-violet)',
                  fontWeight: 400,
                }}
              >
                № 05
              </span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>目標</span>
            </h1>
          </div>
          {/* モックバッジ */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(167,139,250,0.10)',
              border: '1px solid rgba(167,139,250,0.30)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--noxa-accent-violet)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-accent-violet)',
                boxShadow: '0 0 8px var(--noxa-accent-violet)',
              }}
            />
            モック
          </div>
        </div>

        {/* ── 今月の目標カード ─────────────────────────────────── */}
        <section
          aria-label="今月の目標"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 'clamp(16px, 3vw, 24px)',
            marginBottom: 16,
          }}
        >
          <h2
            className="noxa-eyebrow"
            style={{ fontSize: 11, marginBottom: 16 }}
          >
            今月の目標
          </h2>

          {/* 大型数字 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--noxa-text-faint)',
                }}
              >
                目標売上
              </span>
              <span
                style={{
                  fontFamily: display,
                  fontSize: 'clamp(22px, 4vw, 32px)',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  color: 'var(--noxa-text-muted)',
                  lineHeight: 1.1,
                }}
              >
                {yen(GOAL_SALES)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--noxa-text-faint)',
                }}
              >
                実績
              </span>
              <span
                style={{
                  fontFamily: display,
                  fontSize: 'clamp(22px, 4vw, 32px)',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  color: 'var(--noxa-accent-primary-ink)',
                  lineHeight: 1.1,
                }}
              >
                {yen(ACTUAL_SALES)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--noxa-text-faint)',
                }}
              >
                達成率
              </span>
              <span
                style={{
                  fontFamily: display,
                  fontSize: 'clamp(28px, 5vw, 44px)',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  color: 'var(--noxa-accent-violet)',
                  lineHeight: 1.0,
                }}
              >
                {pct(ACHIEVEMENT_RATE)}
              </span>
            </div>
          </div>

          {/* 大型進捗バー */}
          <div>
            <div
              role="progressbar"
              aria-valuenow={ACHIEVEMENT_RATE}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`今月達成率 ${ACHIEVEMENT_RATE}%`}
              style={{
                height: 14,
                background: 'var(--noxa-surface-muted)',
                borderRadius: 7,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${ACHIEVEMENT_RATE}%`,
                  height: '100%',
                  background:
                    'linear-gradient(90deg, var(--noxa-accent-violet) 0%, var(--noxa-accent-primary-neon) 100%)',
                  borderRadius: 7,
                  boxShadow: '0 0 12px rgba(167,139,250,0.5)',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: mono,
                fontSize: 10,
                color: 'var(--noxa-text-faint)',
                marginTop: 6,
              }}
            >
              <span>¥0</span>
              <span>{yen(GOAL_SALES)}</span>
            </div>
          </div>
        </section>

        {/* ── バック内訳 ───────────────────────────────────────── */}
        <section
          aria-label="バック内訳"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 'clamp(16px, 3vw, 24px)',
            marginBottom: 16,
          }}
        >
          <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 16 }}>
            バック内訳
          </h2>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {BACK_ITEMS.map((item) => (
              <BackBar key={item.label} item={item} />
            ))}
          </ul>
        </section>

        {/* ── 過去6ヶ月の達成率 ──────────────────────────────────── */}
        <section
          aria-label="過去6ヶ月の達成率"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 'clamp(16px, 3vw, 24px)',
          }}
        >
          <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 20 }}>
            過去6ヶ月の達成率
          </h2>
          <HistoryChart data={MONTHLY_HISTORY} />
          {/* 平均ライン補足 */}
          <div
            style={{
              marginTop: 12,
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <span>
              平均達成率{' '}
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--noxa-text-muted)',
                }}
              >
                {Math.round(
                  MONTHLY_HISTORY.reduce((s, m) => s + m.rate, 0) /
                    MONTHLY_HISTORY.length
                )}%
              </span>
            </span>
            <span style={{ color: 'var(--noxa-accent-violet)' }}>
              ■ 今月
            </span>
            <span style={{ color: 'var(--noxa-surface-raised)' }}>
              ■ 過去月
            </span>
          </div>
        </section>

        {/* フッター注記 */}
        <p
          style={{
            margin: '16px 0 0',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
          }}
        >
          ※ 現在はモックデータを表示。実装フェーズで Firestore（noxa-platform）の目標コレクションに接続予定。
        </p>
      </div>
    </div>
  );
}

export default GoalsClient;
