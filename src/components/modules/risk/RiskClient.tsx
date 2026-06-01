'use client';

import { useState } from 'react';

/**
 * リスク客共有 — Noxa OS モジュール（モック）
 *
 * 出禁・要注意・売掛トラブル・迷惑行為客を店舗内で共有するモジュール。
 * 実名は伏せ、イニシャル＋特徴のみ表示。共有範囲は自店のみ。
 * ※ 本番実装では Firestore + 権限制御が必要。
 */

const mono = 'var(--noxa-font-mono)';

type RiskCategory = 'banned' | 'caution' | 'credit' | 'nuisance';

type RiskEntry = {
  id: string;
  label: string;       // イニシャル・特徴（例「H様・40代」）
  category: RiskCategory;
  reason: string;
  registeredAt: string; // YYYY-MM-DD
  scope: string;
};

const CATEGORY_META: Record<RiskCategory, { label: string; colorVar: string; borderVar: string; bgVar: string }> = {
  banned: {
    label: '出禁',
    colorVar: 'var(--noxa-status-error, #f87171)',
    borderVar: 'rgba(248,113,113,0.35)',
    bgVar: 'rgba(248,113,113,0.08)',
  },
  caution: {
    label: '要注意',
    colorVar: 'var(--noxa-status-warning, #facc15)',
    borderVar: 'rgba(250,204,21,0.35)',
    bgVar: 'rgba(250,204,21,0.08)',
  },
  credit: {
    label: '売掛トラブル',
    colorVar: 'var(--noxa-accent-destructive, #c084fc)',
    borderVar: 'rgba(192,132,252,0.35)',
    bgVar: 'rgba(192,132,252,0.08)',
  },
  nuisance: {
    label: '迷惑行為',
    colorVar: 'var(--noxa-status-warning, #facc15)',
    borderVar: 'rgba(250,204,21,0.35)',
    bgVar: 'rgba(250,204,21,0.08)',
  },
};

const MOCK_DATA: RiskEntry[] = [
  {
    id: 'r001',
    label: 'T様・50代・スーツ',
    category: 'banned',
    reason: '他の客への暴言、退店要求に応じなかった',
    registeredAt: '2026-05-14',
    scope: '自店のみ',
  },
  {
    id: 'r002',
    label: 'M様・30代・メガネ',
    category: 'credit',
    reason: '売掛 ¥42,000 未回収（3ヶ月経過・連絡途絶）',
    registeredAt: '2026-04-28',
    scope: '自店のみ',
  },
  {
    id: 'r003',
    label: 'K様・40代',
    category: 'caution',
    reason: 'キャストへの過度な接触・退勤後の待ち伏せ',
    registeredAt: '2026-05-20',
    scope: '自店のみ',
  },
  {
    id: 'r004',
    label: 'H様・60代・白髪',
    category: 'nuisance',
    reason: '過度の飲酒後に他卓へ絡む・注意後も改善なし',
    registeredAt: '2026-05-02',
    scope: '自店のみ',
  },
  {
    id: 'r005',
    label: 'Y様・20代',
    category: 'credit',
    reason: '売掛 ¥18,000 未回収（SNS ブロック済み）',
    registeredAt: '2026-03-30',
    scope: '自店のみ',
  },
  {
    id: 'r006',
    label: 'S様・40代・長身',
    category: 'banned',
    reason: '器物破損（グラス）・示談拒否',
    registeredAt: '2026-02-15',
    scope: '自店のみ',
  },
  {
    id: 'r007',
    label: 'N様・30代',
    category: 'caution',
    reason: '無断キャンセル複数回・予約席の長時間占有',
    registeredAt: '2026-05-29',
    scope: '自店のみ',
  },
];

type FilterKey = 'all' | RiskCategory;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'banned', label: '出禁' },
  { key: 'caution', label: '要注意' },
  { key: 'credit', label: '売掛トラブル' },
  { key: 'nuisance', label: '迷惑行為' },
];

export function RiskClient() {
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = filter === 'all' ? MOCK_DATA : MOCK_DATA.filter((r) => r.category === filter);

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
          top: '-30%',
          right: '-10%',
          width: 600,
          height: 380,
          background: 'radial-gradient(ellipse, rgba(248,113,113,0.07) 0%, transparent 65%)',
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
              <a href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </a>
            </li>
            <li aria-hidden>·</li>
            <li>risk</li>
          </ol>
        </nav>

        {/* eyebrow + 見出し */}
        <div style={{ marginBottom: 20 }}>
          <div
            className="noxa-eyebrow"
            style={{ marginBottom: 6, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}
          >
            Noxa OS · Module · Risk
          </div>
          <h1
            style={{
              fontSize: 'clamp(24px, 4vw, 36px)',
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
                color: 'var(--noxa-status-error, #f87171)',
                fontWeight: 400,
              }}
            >
              Risk
            </span>
            <span
              style={{
                fontFamily: 'var(--noxa-font-display-jp)',
                fontWeight: 500,
              }}
            >
              リスク客共有
            </span>
          </h1>
        </div>

        {/* 重要注記バナー */}
        <div
          role="note"
          aria-label="取り扱い注意事項"
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            background: 'rgba(248,113,113,0.07)',
            border: '1px solid rgba(248,113,113,0.30)',
            borderRadius: 12,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              marginTop: 1,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'rgba(248,113,113,0.25)',
              border: '1px solid rgba(248,113,113,0.50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: 'var(--noxa-status-error, #f87171)',
              fontWeight: 700,
            }}
          >
            !
          </span>
          <div>
            <p
              style={{
                margin: '0 0 3px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--noxa-status-error, #f87171)',
                fontFamily: mono,
                letterSpacing: '0.04em',
              }}
            >
              取り扱い注意 — 店舗内限定情報
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--noxa-text-muted)', lineHeight: 1.6 }}>
              この情報は自店スタッフのみが閲覧できます。個人情報保護の観点から実名は記録せず、外部への共有・スクリーンショット配布は禁止です。
            </p>
          </div>
        </div>

        {/* フィルタ */}
        <div
          role="tablist"
          aria-label="リスク区分フィルタ"
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '5px 13px',
                  borderRadius: 9999,
                  border: active ? '1px solid var(--noxa-accent-primary)' : '1px solid var(--noxa-border)',
                  background: active ? 'rgba(103,232,249,0.10)' : 'transparent',
                  color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)',
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                }}
              >
                {f.label}
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)',
                  }}
                >
                  {f.key === 'all' ? MOCK_DATA.length : MOCK_DATA.filter((r) => r.category === f.key).length}
                </span>
              </button>
            );
          })}
        </div>

        {/* リスト */}
        <ul
          aria-label="リスク客一覧"
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {filtered.map((entry) => {
            const meta = CATEGORY_META[entry.category];
            return (
              <li
                key={entry.id}
                style={{
                  background: 'var(--noxa-surface-card)',
                  border: `1px solid var(--noxa-border)`,
                  borderLeft: `3px solid ${meta.colorVar}`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {/* カード上段：ラベル + バッジ */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--noxa-text-primary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {entry.label}
                  </span>
                  <span
                    aria-label={`区分: ${meta.label}`}
                    style={{
                      flexShrink: 0,
                      padding: '3px 10px',
                      borderRadius: 9999,
                      border: `1px solid ${meta.borderVar}`,
                      background: meta.bgVar,
                      fontFamily: mono,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: meta.colorVar,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {meta.label}
                  </span>
                </div>

                {/* 理由 */}
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--noxa-text-muted)',
                    lineHeight: 1.6,
                  }}
                >
                  {entry.reason}
                </p>

                {/* 下段：登録日 + 共有範囲 */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: 'var(--noxa-text-faint)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    登録日：{entry.registeredAt}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontFamily: mono,
                      fontSize: 10,
                      color: 'var(--noxa-text-faint)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: 'var(--noxa-text-faint)',
                        opacity: 0.5,
                      }}
                    />
                    {entry.scope}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* 「登録」ボタン */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            aria-label="リスク客を新規登録（未実装）"
            disabled
            style={{
              padding: '9px 22px',
              borderRadius: 9999,
              border: '1px solid var(--noxa-border)',
              background: 'var(--noxa-surface-card)',
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: '0.08em',
              cursor: 'not-allowed',
              opacity: 0.6,
            }}
          >
            + 登録（準備中）
          </button>
        </div>

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
          ※ 表示はモックデータです。本番実装では Firestore + 店舗権限制御が必要です。
        </p>
      </div>
    </div>
  );
}

export default RiskClient;
