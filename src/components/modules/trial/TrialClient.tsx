'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * 体験入店 — Noxa OS モジュール（モック）
 *
 * 採用パイプライン: 応募 → 体験予約 → 体験中 → 評価 → 本入店
 * 実データ連携は未実装。ガワ（UI モック）のみ。
 */

const mono = 'var(--noxa-font-mono)';

type TrialStatus = 'applied' | 'scheduled' | 'ongoing' | 'review' | 'hired' | 'rejected';
type Source = 'SNS' | '紹介' | '求人';

type Candidate = {
  id: string;
  name: string; // 源氏名(仮)
  source: Source;
  trialDate: string; // YYYY-MM-DD
  assignee: string; // 担当
  rating: number; // 1〜5（0 は未評価）
  nextAction: string;
  status: TrialStatus;
};

const MOCK_CANDIDATES: Candidate[] = [
  {
    id: 'c1',
    name: 'あかり（仮）',
    source: 'SNS',
    trialDate: '2026-06-05',
    assignee: '田中',
    rating: 0,
    nextAction: '体験日を確定する',
    status: 'applied',
  },
  {
    id: 'c2',
    name: 'みく（仮）',
    source: '紹介',
    trialDate: '2026-06-07',
    assignee: '山本',
    rating: 0,
    nextAction: '当日連絡',
    status: 'scheduled',
  },
  {
    id: 'c3',
    name: 'ゆいな（仮）',
    source: '求人',
    trialDate: '2026-06-02',
    assignee: '田中',
    rating: 0,
    nextAction: '体験終了後に評価入力',
    status: 'ongoing',
  },
  {
    id: 'c4',
    name: 'れな（仮）',
    source: 'SNS',
    trialDate: '2026-05-30',
    assignee: '山本',
    rating: 4,
    nextAction: '本入店オファーを送る',
    status: 'review',
  },
  {
    id: 'c5',
    name: 'さくら（仮）',
    source: '紹介',
    trialDate: '2026-05-28',
    assignee: '佐藤',
    rating: 5,
    nextAction: '契約書を準備',
    status: 'hired',
  },
  {
    id: 'c6',
    name: 'ひな（仮）',
    source: '求人',
    trialDate: '2026-05-25',
    assignee: '田中',
    rating: 2,
    nextAction: '—',
    status: 'rejected',
  },
  {
    id: 'c7',
    name: 'こはる（仮）',
    source: 'SNS',
    trialDate: '2026-06-03',
    assignee: '佐藤',
    rating: 0,
    nextAction: '体験日程を調整中',
    status: 'scheduled',
  },
  {
    id: 'c8',
    name: 'まな（仮）',
    source: '紹介',
    trialDate: '2026-05-31',
    assignee: '山本',
    rating: 3,
    nextAction: '追加面談を設定',
    status: 'review',
  },
];

const PIPELINE_STEPS: { key: TrialStatus; label: string }[] = [
  { key: 'applied', label: '応募' },
  { key: 'scheduled', label: '体験予約' },
  { key: 'ongoing', label: '体験中' },
  { key: 'review', label: '評価' },
  { key: 'hired', label: '本入店' },
];

const STATUS_META: Record<TrialStatus, { label: string; color: string; bg: string; border: string }> = {
  applied: {
    label: '応募',
    color: 'var(--noxa-status-info)',
    bg: 'rgba(99,179,237,0.10)',
    border: 'rgba(99,179,237,0.30)',
  },
  scheduled: {
    label: '体験予約',
    color: 'var(--noxa-status-warning)',
    bg: 'rgba(246,173,85,0.10)',
    border: 'rgba(246,173,85,0.30)',
  },
  ongoing: {
    label: '体験中',
    color: 'var(--noxa-accent-primary-ink)',
    bg: 'rgba(103,232,249,0.10)',
    border: 'rgba(103,232,249,0.30)',
  },
  review: {
    label: '評価',
    color: 'var(--noxa-text-muted)',
    bg: 'var(--noxa-surface-muted)',
    border: 'var(--noxa-border)',
  },
  hired: {
    label: '本入店',
    color: 'var(--noxa-status-success)',
    bg: 'rgba(123,232,161,0.10)',
    border: 'rgba(123,232,161,0.30)',
  },
  rejected: {
    label: '不採用',
    color: 'var(--noxa-status-error)',
    bg: 'rgba(252,129,129,0.08)',
    border: 'rgba(252,129,129,0.25)',
  },
};

/** 星評価レンダリング */
function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`評価 ${rating} 点`} style={{ fontFamily: mono, fontSize: 12, letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= rating ? 'var(--noxa-status-warning)' : 'var(--noxa-surface-muted)' }}>
          ★
        </span>
      ))}
    </span>
  );
}

/** ステータスバッジ */
function StatusBadge({ status }: { status: TrialStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 9999,
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: '0.10em',
        color: m.color,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: m.color,
          flexShrink: 0,
        }}
      />
      {m.label}
    </span>
  );
}

/** KPI カード */
function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
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
          color: 'var(--noxa-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** 候補者カード（リスト行） */
function CandidateRow({
  candidate,
  onHire,
  onReject,
}: {
  candidate: Candidate;
  onHire: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isFinalized = candidate.status === 'hired' || candidate.status === 'rejected';
  return (
    <li
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* 上段: 名前・バッジ・日付 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{candidate.name}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={candidate.status} />
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: 'var(--noxa-text-faint)',
                background: 'var(--noxa-surface-muted)',
                padding: '2px 7px',
                borderRadius: 9999,
              }}
            >
              {candidate.source}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.06em',
            }}
          >
            体験日
          </div>
          <div style={{ fontFamily: mono, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            {candidate.trialDate.replace(/^2026-/, '')}
          </div>
        </div>
      </div>

      {/* 中段: 担当・評価・次アクション */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>担当</div>
          <div style={{ fontSize: 13 }}>{candidate.assignee}</div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>評価</div>
          {candidate.rating > 0 ? (
            <Stars rating={candidate.rating} />
          ) : (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>未評価</span>
          )}
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginBottom: 2 }}>
            次アクション
          </div>
          <div style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{candidate.nextAction}</div>
        </div>
      </div>

      {/* 下段: アクションボタン */}
      {!isFinalized && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
          <button
            type="button"
            onClick={() => onHire(candidate.id)}
            aria-label={`${candidate.name} を本入店にする`}
            style={{
              padding: '6px 14px',
              background: 'rgba(123,232,161,0.12)',
              border: '1px solid rgba(123,232,161,0.35)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-status-success)',
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.75')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            本入店にする
          </button>
          <button
            type="button"
            onClick={() => onReject(candidate.id)}
            aria-label={`${candidate.name} を不採用にする`}
            style={{
              padding: '6px 14px',
              background: 'rgba(252,129,129,0.08)',
              border: '1px solid rgba(252,129,129,0.25)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-status-error)',
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.75')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            不採用
          </button>
        </div>
      )}
    </li>
  );
}

export function TrialClient() {
  const [candidates, setCandidates] = useState<Candidate[]>(MOCK_CANDIDATES);
  const [filterStatus, setFilterStatus] = useState<TrialStatus | 'all'>('all');

  /** 本入店（no-op: ステータスを hired に更新するのみ） */
  const handleHire = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'hired' as TrialStatus, nextAction: '契約書を準備' } : c)),
    );
  };

  /** 不採用（no-op: ステータスを rejected に更新するのみ） */
  const handleReject = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'rejected' as TrialStatus, nextAction: '—' } : c)),
    );
  };

  const active = candidates.filter((c) => c.status !== 'rejected');
  const todayCount = candidates.filter((c) => c.trialDate === '2026-06-02').length;
  const monthCount = candidates.filter((c) => c.trialDate.startsWith('2026-06')).length;
  const hiredCount = candidates.filter((c) => c.status === 'hired').length;
  const eligibleCount = candidates.filter(
    (c) => c.status === 'hired' || c.status === 'review',
  ).length;
  const hireRate =
    eligibleCount > 0 ? `${Math.round((hiredCount / eligibleCount) * 100)}%` : '—';

  const filtered =
    filterStatus === 'all' ? candidates : candidates.filter((c) => c.status === filterStatus);

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
          background:
            'radial-gradient(ellipse, rgba(246,173,85,0.07) 0%, transparent 65%)',
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
            <li>trial</li>
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
              Noxa OS · Trial
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
                №
              </span>
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-jp)',
                  fontWeight: 500,
                }}
              >
                体験入店
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
              background: 'rgba(246,173,85,0.10)',
              border: '1px solid rgba(246,173,85,0.30)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--noxa-status-warning)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-status-warning)',
                boxShadow: '0 0 8px var(--noxa-status-warning)',
              }}
            />
            モック
          </div>
        </div>

        {/* KPI サマリ */}
        <div
          className="grid grid-cols-2 lg:grid-cols-3"
          style={{ gap: 12, marginBottom: 24 }}
        >
          <KpiCard label="本日の体験" value={todayCount} />
          <KpiCard label="今月の体験" value={monthCount} />
          <KpiCard label="本入店化率" value={hireRate} />
        </div>

        {/* パイプライン概要バー */}
        <section aria-label="ステータス別パイプライン" style={{ marginBottom: 20 }}>
          <h2
            className="noxa-eyebrow"
            style={{ fontSize: 11, marginBottom: 10, color: 'var(--noxa-text-faint)' }}
          >
            パイプライン
          </h2>
          <div
            style={{
              display: 'flex',
              gap: 0,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 4,
            }}
            role="list"
          >
            {PIPELINE_STEPS.map((step, i) => {
              const count = candidates.filter((c) => c.status === step.key).length;
              const isActive = filterStatus === step.key;
              const meta = STATUS_META[step.key];
              return (
                <button
                  key={step.key}
                  type="button"
                  role="listitem"
                  onClick={() => setFilterStatus(isActive ? 'all' : step.key)}
                  aria-pressed={isActive}
                  aria-label={`${step.label}（${count}名）でフィルタ`}
                  style={{
                    flex: '1 1 0',
                    minWidth: 72,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '10px 8px',
                    background: isActive ? meta.bg : 'transparent',
                    border: `1px solid ${isActive ? meta.border : 'var(--noxa-border)'}`,
                    borderRight: i < PIPELINE_STEPS.length - 1 ? 'none' : undefined,
                    borderRadius:
                      i === 0 ? '10px 0 0 10px' : i === PIPELINE_STEPS.length - 1 ? '0 10px 10px 0' : 0,
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 18,
                      fontWeight: 700,
                      color: isActive ? meta.color : 'var(--noxa-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {count}
                  </span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      color: isActive ? meta.color : 'var(--noxa-text-faint)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* フィルタ制御 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            aria-pressed={filterStatus === 'all'}
            style={{
              padding: '5px 12px',
              background: filterStatus === 'all' ? 'var(--noxa-surface-muted)' : 'transparent',
              border: '1px solid var(--noxa-border)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-muted)',
              cursor: 'pointer',
            }}
          >
            すべて（{candidates.length}）
          </button>
          <button
            type="button"
            onClick={() =>
              setFilterStatus(filterStatus === 'rejected' ? 'all' : 'rejected')
            }
            aria-pressed={filterStatus === 'rejected'}
            style={{
              padding: '5px 12px',
              background:
                filterStatus === 'rejected'
                  ? STATUS_META.rejected.bg
                  : 'transparent',
              border: `1px solid ${
                filterStatus === 'rejected'
                  ? STATUS_META.rejected.border
                  : 'var(--noxa-border)'
              }`,
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 11,
              color:
                filterStatus === 'rejected'
                  ? STATUS_META.rejected.color
                  : 'var(--noxa-text-faint)',
              cursor: 'pointer',
            }}
          >
            不採用（{candidates.filter((c) => c.status === 'rejected').length}）
          </button>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
            }}
          >
            アクティブ {active.length} 名
          </span>
        </div>

        {/* 候補者リスト */}
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              border: '1px solid var(--noxa-border)',
              borderRadius: 14,
              background: 'var(--noxa-surface-card)',
              textAlign: 'center',
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
              fontSize: 13,
            }}
          >
            該当する候補者はいません
          </div>
        ) : (
          <ul
            aria-label="候補者一覧"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {filtered.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                onHire={handleHire}
                onReject={handleReject}
              />
            ))}
          </ul>
        )}

        <p
          style={{
            margin: '16px 0 0',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
          }}
        >
          ※ 現在モックデータを表示中。実データ連携は未実装。
        </p>
      </div>
    </div>
  );
}

export default TrialClient;
