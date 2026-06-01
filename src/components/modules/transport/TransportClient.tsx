'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ⑦ 送迎 — 配車ボード + 送迎リクエスト一覧 + 地図プレースホルダ UI モック（ガワのみ）
 *
 * ロジック・永続化なし。すべて MOCK_* のモックデータ。
 * UI 内部 state（選択リクエスト）のみ useState。ボタンは no-op。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

type VehicleStatus = 'standby' | 'on_trip' | 'returning';

type MockVehicle = {
  id: string;
  name: string;
  driver: string;
  status: VehicleStatus;
  note?: string;
};

const MOCK_VEHICLES: MockVehicle[] = [
  { id: 'V1', name: 'アルファード #1', driver: '田中ドライバー', status: 'standby' },
  { id: 'V2', name: 'ヴェルファイア #2', driver: '山田ドライバー', status: 'on_trip', note: '大阪ミナミ → 梅田' },
  { id: 'V3', name: 'ハイエース #3', driver: '佐藤ドライバー', status: 'returning', note: '心斎橋より戻り中' },
];

type RequestType = 'companion_pickup' | 'after_work';
type RequestStatus = 'waiting' | 'assigned' | 'in_progress' | 'done';

type MockRequest = {
  id: string;
  time: string;
  type: RequestType;
  destination: string;
  personName: string;
  status: RequestStatus;
};

const MOCK_REQUESTS: MockRequest[] = [
  { id: 'R1', time: '22:15', type: 'companion_pickup', destination: '北新地 THE BAR', personName: '玲奈', status: 'assigned' },
  { id: 'R2', time: '22:30', type: 'companion_pickup', destination: '心斎橋 Lounge Lux', personName: 'ひかり', status: 'waiting' },
  { id: 'R3', time: '23:45', type: 'after_work', destination: '堺筋本町（自宅方面）', personName: '美咲', status: 'in_progress' },
  { id: 'R4', time: '01:00', type: 'after_work', destination: '天王寺（自宅方面）', personName: 'さくら', status: 'waiting' },
  { id: 'R5', time: '01:30', type: 'after_work', destination: '難波周辺', personName: 'ゆい', status: 'done' },
];

// ─────────────────────────────────────────────
// ヘルパー・定数
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

const VEHICLE_STATUS_META: Record<VehicleStatus, { label: string; color: string }> = {
  standby:    { label: '待機中',   color: 'var(--noxa-status-success)' },
  on_trip:    { label: '送迎中',   color: 'var(--noxa-status-info)' },
  returning:  { label: '戻り中',   color: 'var(--noxa-status-warning)' },
};

const REQUEST_TYPE_META: Record<RequestType, { label: string; color: string }> = {
  companion_pickup: { label: '同伴PU', color: 'var(--noxa-accent-primary-ink)' },
  after_work:       { label: '退勤',   color: 'var(--noxa-status-info)' },
};

const REQUEST_STATUS_META: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  waiting:     { label: '待機',     color: 'var(--noxa-text-muted)',          bg: 'rgba(255,255,255,0.05)' },
  assigned:    { label: '配車済',   color: 'var(--noxa-accent-primary-ink)', bg: 'rgba(139, 92, 246, 0.15)' },
  in_progress: { label: '送迎中',   color: 'var(--noxa-status-info)',        bg: 'rgba(103, 232, 249, 0.12)' },
  done:        { label: '完了',     color: 'var(--noxa-status-success)',     bg: 'rgba(123, 232, 161, 0.10)' },
};

// ダミーピン位置（地図プレースホルダ内の絶対座標 %）
const MOCK_PINS = [
  { id: 'p1', top: '38%', left: '42%', color: 'var(--noxa-accent-primary-ink)' },
  { id: 'p2', top: '55%', left: '61%', color: 'var(--noxa-status-info)' },
  { id: 'p3', top: '28%', left: '58%', color: 'var(--noxa-status-warning)' },
];

// ─────────────────────────────────────────────
// サブコンポーネント
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

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export function TransportClient() {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>('R1');

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
          width: 680,
          height: 400,
          background: 'radial-gradient(ellipse, rgba(103, 232, 249, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-25%',
          left: '-5%',
          width: 500,
          height: 360,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.08) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>

        {/* ─ ヘッダー ─ */}
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
              <li>transport</li>
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
                Noxa OS · Module 07 · Transport
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
                  № 07
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  送迎
                </span>
              </h1>
            </div>

            {/* モック表示バッジ */}
            <div
              role="note"
              aria-label="このモジュールはモックUIです"
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
                style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-info)' }}
              />
              モック UI · ロジックなし
            </div>
          </div>
        </header>

        {/* ─ 配車ボード ─ */}
        <section aria-label="配車ボード" style={{ marginBottom: 'clamp(16px, 2vw, 24px)' }}>
          <PaneTitle>配車ボード</PaneTitle>
          <div
            className="grid grid-cols-1 sm:grid-cols-3"
            style={{ gap: 'clamp(10px, 1.4vw, 14px)' }}
          >
            {MOCK_VEHICLES.map((v) => {
              const meta = VEHICLE_STATUS_META[v.status];
              return (
                <div
                  key={v.id}
                  role="article"
                  aria-label={`${v.name} — ${meta.label}`}
                  style={{
                    background: 'var(--noxa-surface-card)',
                    border: `1px solid ${
                      v.status === 'on_trip'
                        ? 'rgba(103, 232, 249, 0.30)'
                        : v.status === 'returning'
                          ? 'rgba(245, 212, 114, 0.30)'
                          : 'var(--noxa-border)'
                    }`,
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: v.status === 'on_trip' ? '0 0 16px rgba(103, 232, 249, 0.08)' : 'none',
                  }}
                >
                  {/* 車両名 + ステータス */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--noxa-text-primary)',
                      }}
                    >
                      {v.name}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 9px',
                        borderRadius: 9999,
                        background: 'rgba(255,255,255,0.05)',
                        border: `1px solid ${meta.color}33`,
                        fontFamily: mono,
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        color: meta.color,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          background: meta.color,
                          boxShadow: `0 0 6px ${meta.color}`,
                          flex: 'none',
                        }}
                      />
                      {meta.label}
                    </span>
                  </div>

                  {/* ドライバー名 */}
                  <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)', fontFamily: mono }}>
                    {v.driver}
                  </span>

                  {/* 現在の行程メモ */}
                  {v.note && (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--noxa-text-faint)',
                        borderTop: '1px solid var(--noxa-divider)',
                        paddingTop: 8,
                        marginTop: 2,
                        lineHeight: 1.5,
                      }}
                    >
                      {v.note}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ─ メイン 2ペイン（リクエスト一覧 + 地図） ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_340px]"
          style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}
        >
          {/* 送迎リクエスト一覧 */}
          <section aria-label="送迎リクエスト一覧">
            <PaneTitle>送迎リクエスト</PaneTitle>

            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {/* テーブルヘッダー */}
              <div
                role="rowheader"
                aria-hidden
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 80px 1fr 120px 80px auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--noxa-divider)',
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: '0.10em',
                  color: 'var(--noxa-text-faint)',
                  textTransform: 'uppercase',
                }}
              >
                <span>時刻</span>
                <span>種別</span>
                <span>行き先</span>
                <span>担当</span>
                <span>状態</span>
                <span></span>
              </div>

              {/* リクエスト行 */}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} role="list" aria-label="送迎リクエスト">
                {MOCK_REQUESTS.map((req, idx) => {
                  const typeMeta = REQUEST_TYPE_META[req.type];
                  const statusMeta = REQUEST_STATUS_META[req.status];
                  const isSelected = req.id === selectedRequestId;

                  return (
                    <li
                      key={req.id}
                      role="row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '60px 80px 1fr 120px 80px auto',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px 16px',
                        borderBottom: idx < MOCK_REQUESTS.length - 1 ? '1px solid var(--noxa-divider)' : 'none',
                        background: isSelected ? 'rgba(139, 92, 246, 0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background var(--noxa-duration-fast) var(--noxa-ease-natural)',
                      }}
                      onClick={() => setSelectedRequestId(isSelected ? null : req.id)}
                      aria-selected={isSelected}
                    >
                      {/* 時刻 */}
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 14,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--noxa-text-primary)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {req.time}
                      </span>

                      {/* 種別バッジ */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: 9999,
                          background: `${typeMeta.color}1A`,
                          border: `1px solid ${typeMeta.color}33`,
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          color: typeMeta.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {typeMeta.label}
                      </span>

                      {/* 行き先 */}
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--noxa-text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {req.destination}
                      </span>

                      {/* 客名 / キャスト名 */}
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--noxa-text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {req.personName}
                      </span>

                      {/* ステータスバッジ */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: 9999,
                          background: statusMeta.bg,
                          border: `1px solid ${statusMeta.color}33`,
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          color: statusMeta.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {statusMeta.label}
                      </span>

                      {/* 配車ボタン */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          /* no-op: ガワのみ */
                        }}
                        aria-label={`${req.personName} のリクエストに配車する`}
                        disabled={req.status === 'done' || req.status === 'in_progress'}
                        style={{
                          appearance: 'none',
                          cursor: req.status === 'done' || req.status === 'in_progress' ? 'not-allowed' : 'pointer',
                          minHeight: 32,
                          minWidth: 70,
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--noxa-accent-primary)',
                          background:
                            req.status === 'done' || req.status === 'in_progress'
                              ? 'transparent'
                              : 'var(--noxa-accent-primary)',
                          color:
                            req.status === 'done' || req.status === 'in_progress'
                              ? 'var(--noxa-text-faint)'
                              : '#fff',
                          fontFamily: 'var(--noxa-font-sans-jp)',
                          fontSize: 12,
                          fontWeight: 600,
                          opacity: req.status === 'done' || req.status === 'in_progress' ? 0.35 : 1,
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                          whiteSpace: 'nowrap',
                          boxShadow:
                            req.status === 'done' || req.status === 'in_progress'
                              ? 'none'
                              : 'var(--noxa-glow-soft)',
                        }}
                      >
                        配車する
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* 地図プレースホルダ */}
          <section aria-label="地図パネル">
            <PaneTitle>地図プレビュー</PaneTitle>

            <div
              aria-label="地図プレビュー（モック）"
              role="img"
              style={{
                position: 'relative',
                width: '100%',
                height: 'clamp(260px, 40vw, 420px)',
                borderRadius: 16,
                border: '1px solid var(--noxa-border)',
                overflow: 'hidden',
                background: 'radial-gradient(ellipse at 40% 45%, #12103A 0%, #0A081E 40%, #07050D 100%)',
              }}
            >
              {/* グリッドライン装飾 */}
              <svg
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0.12,
                }}
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* 縦線 */}
                {[0.2, 0.4, 0.6, 0.8].map((x) => (
                  <line
                    key={`v${x}`}
                    x1={`${x * 100}%`}
                    y1="0"
                    x2={`${x * 100}%`}
                    y2="100%"
                    stroke="var(--noxa-border-strong)"
                    strokeWidth="1"
                  />
                ))}
                {/* 横線 */}
                {[0.25, 0.5, 0.75].map((y) => (
                  <line
                    key={`h${y}`}
                    x1="0"
                    y1={`${y * 100}%`}
                    x2="100%"
                    y2={`${y * 100}%`}
                    stroke="var(--noxa-border-strong)"
                    strokeWidth="1"
                  />
                ))}
              </svg>

              {/* 道路風ライン装飾 */}
              <svg
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0.18,
                }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polyline
                  points="0,55 25,48 50,52 75,44 100,50"
                  fill="none"
                  stroke="var(--noxa-border-strong)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points="20,0 30,35 55,55 65,100"
                  fill="none"
                  stroke="var(--noxa-border-strong)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {/* MAP PREVIEW テキスト */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 'clamp(11px, 1.4vw, 14px)',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-faint)',
                    fontWeight: 400,
                  }}
                >
                  MAP PREVIEW
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--noxa-text-faint)',
                    opacity: 0.6,
                  }}
                >
                  実地図 API 未接続
                </span>
              </div>

              {/* ダミーピン */}
              {MOCK_PINS.map((pin) => (
                <div
                  key={pin.id}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: pin.top,
                    left: pin.left,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* 外側グロー */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      background: pin.color,
                      opacity: 0.18,
                    }}
                  />
                  {/* ピン本体 */}
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: pin.color,
                      border: '2px solid rgba(255,255,255,0.6)',
                      boxShadow: `0 0 8px ${pin.color}`,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  />
                </div>
              ))}

              {/* 凡例 */}
              <div
                aria-label="地図凡例"
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  padding: '8px 10px',
                  background: 'rgba(7, 5, 13, 0.72)',
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 10,
                  backdropFilter: 'blur(6px)',
                }}
              >
                {Object.entries(VEHICLE_STATUS_META).map(([key, meta]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 4,
                        background: meta.color,
                        flex: 'none',
                      }}
                    />
                    <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)', letterSpacing: '0.08em' }}>
                      {meta.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 選択リクエストの詳細カード */}
            {selectedRequestId && (() => {
              const req = MOCK_REQUESTS.find((r) => r.id === selectedRequestId);
              if (!req) return null;
              const typeMeta = REQUEST_TYPE_META[req.type];
              const statusMeta = REQUEST_STATUS_META[req.status];
              return (
                <div
                  aria-label={`${req.personName} のリクエスト詳細`}
                  style={{
                    marginTop: 12,
                    background: 'var(--noxa-surface-card)',
                    border: '1px solid var(--noxa-border-strong)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, color: 'var(--noxa-text-primary)' }}>
                      {req.personName}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '3px 9px',
                        borderRadius: 9999,
                        background: statusMeta.bg,
                        border: `1px solid ${statusMeta.color}33`,
                        fontFamily: mono,
                        fontSize: 10,
                        color: statusMeta.color,
                      }}
                    >
                      {statusMeta.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <DetailRow label="時刻" value={req.time} mono />
                    <DetailRow label="種別" value={typeMeta.label} color={typeMeta.color} />
                    <DetailRow label="行き先" value={req.destination} />
                  </div>
                  <button
                    type="button"
                    onClick={() => { /* no-op */ }}
                    aria-label="Google Maps で開く（モック）"
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      width: '100%',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid var(--noxa-border-strong)',
                      background: 'var(--noxa-surface-muted)',
                      color: 'var(--noxa-text-muted)',
                      fontFamily: 'var(--noxa-font-sans-jp)',
                      fontSize: 12,
                      fontWeight: 500,
                      transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    }}
                  >
                    Google Maps で開く（モック）
                  </button>
                </div>
              );
            })()}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 詳細カード内の行
// ─────────────────────────────────────────────
function DetailRow({
  label,
  value,
  mono: isMono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  const monoFont = 'var(--noxa-font-mono)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)', fontFamily: monoFont, letterSpacing: '0.08em', flex: 'none' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: color ?? 'var(--noxa-text-primary)',
          fontFamily: isMono ? monoFont : 'var(--noxa-font-sans-jp)',
          fontVariantNumeric: isMono ? 'tabular-nums' : undefined,
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default TransportClient;
