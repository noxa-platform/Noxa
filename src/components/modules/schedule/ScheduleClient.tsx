'use client';

import Link from 'next/link';

/**
 * スケジュール管理 — Noxa OS モジュール（モック）
 *
 * 月カレンダー + 今後の予定リスト。
 * 実データ連携は今後の実装予定。
 */

const mono = 'var(--noxa-font-mono)';

// ──────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────

type EventKind = 'shift' | 'event' | 'meeting';

type ScheduleEvent = {
  id: string;
  date: number;       // 日（1〜31）
  time: string;       // "HH:MM" 形式
  endTime?: string;
  title: string;
  place: string;
  kind: EventKind;
};

// ──────────────────────────────────────────
// モックデータ（固定: 2026年6月）
// ──────────────────────────────────────────

const MOCK_YEAR = 2026;
const MOCK_MONTH = 6; // 1-indexed

const MOCK_EVENTS: ScheduleEvent[] = [
  { id: 'e1', date: 3,  time: '19:00', endTime: '03:00', title: '出勤',              place: 'Club NOXA · 北新地',        kind: 'shift'   },
  { id: 'e2', date: 5,  time: '20:00', endTime: '22:00', title: 'VIP ディナーイベント', place: 'THE OSAKA · 梅田',          kind: 'event'   },
  { id: 'e3', date: 7,  time: '15:00', endTime: '16:00', title: 'マネージャーMTG',    place: 'NOXA バックオフィス',         kind: 'meeting' },
  { id: 'e4', date: 10, time: '19:00', endTime: '03:00', title: '出勤',              place: 'Club NOXA · 北新地',        kind: 'shift'   },
  { id: 'e5', date: 14, time: '18:00', endTime: '21:00', title: '周年記念パーティ',   place: 'Grand Ballroom · 心斎橋',   kind: 'event'   },
  { id: 'e6', date: 15, time: '14:00', endTime: '15:00', title: 'キャスト面談',       place: 'NOXA バックオフィス',         kind: 'meeting' },
  { id: 'e7', date: 18, time: '19:00', endTime: '03:00', title: '出勤',              place: 'Club NOXA · 北新地',        kind: 'shift'   },
  { id: 'e8', date: 21, time: '20:00', endTime: '23:00', title: 'メディア取材イベント', place: 'Studio Cube · 難波',        kind: 'event'   },
];

/** 今日の日として使う固定値（モック） */
const TODAY_DATE = 2;

// ──────────────────────────────────────────
// カレンダー計算ユーティリティ
// ──────────────────────────────────────────

/** 2026-06-01 は月曜（weekday=1） → startOffset=1 */
const START_WEEKDAY = 1; // 0=日, 1=月, …, 6=土
const DAYS_IN_MONTH = 30;
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 予定のある日のセット */
const EVENT_DATES = new Set(MOCK_EVENTS.map((e) => e.date));

// ──────────────────────────────────────────
// 種別スタイル
// ──────────────────────────────────────────

const KIND_META: Record<EventKind, { label: string; dot: string; bg: string; text: string }> = {
  shift: {
    label: '出勤',
    dot:   'var(--noxa-accent-primary)',
    bg:    'rgba(167,139,250,0.12)',   // violet tint
    text:  'var(--noxa-accent-primary)',
  },
  event: {
    label: 'イベント',
    dot:   'var(--noxa-accent-secondary)',
    bg:    'rgba(103,232,249,0.10)',   // cyan tint
    text:  'var(--noxa-accent-secondary)',
  },
  meeting: {
    label: 'MTG',
    dot:   'var(--noxa-status-warning)',
    bg:    'rgba(251,191,36,0.10)',    // warning tint
    text:  'var(--noxa-status-warning)',
  },
};

// ──────────────────────────────────────────
// サブコンポーネント
// ──────────────────────────────────────────

/** カレンダーグリッド */
function MonthCalendar() {
  // グリッドセルを生成（空セル + 日付セル）
  const cells: Array<{ empty: true } | { empty: false; day: number }> = [];
  for (let i = 0; i < START_WEEKDAY; i++) {
    cells.push({ empty: true });
  }
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    cells.push({ empty: false, day: d });
  }

  return (
    <section
      aria-label={`${MOCK_YEAR}年${MOCK_MONTH}月カレンダー`}
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 16,
        padding: 18,
      }}
    >
      {/* カレンダーヘッダ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2
          style={{
            fontFamily: 'var(--noxa-font-display-en)',
            fontStyle: 'italic',
            fontSize: 20,
            fontWeight: 400,
            color: 'var(--noxa-text-primary)',
            margin: 0,
          }}
        >
          June <span style={{ fontFamily: mono, fontStyle: 'normal', fontSize: 13, color: 'var(--noxa-text-muted)', marginLeft: 6 }}>2026</span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* 凡例 */}
          {(Object.entries(KIND_META) as [EventKind, typeof KIND_META[EventKind]][]).map(([k, m]) => (
            <span
              key={k}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: mono,
                fontSize: 9,
                letterSpacing: '0.08em',
                color: 'var(--noxa-text-faint)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: m.dot,
                  boxShadow: `0 0 6px ${m.dot}`,
                  flexShrink: 0,
                }}
              />
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* 曜日ラベル行 */}
      <div
        role="row"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          marginBottom: 6,
        }}
      >
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            role="columnheader"
            aria-label={w + '曜日'}
            style={{
              textAlign: 'center',
              fontFamily: mono,
              fontSize: 9,
              letterSpacing: '0.10em',
              color: 'var(--noxa-text-faint)',
              padding: '2px 0 6px',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div
        role="grid"
        aria-label="日付"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
        }}
      >
        {cells.map((cell, idx) => {
          if (cell.empty) {
            return <div key={`empty-${idx}`} role="gridcell" aria-hidden style={{ aspectRatio: '1', minHeight: 32 }} />;
          }
          const { day } = cell;
          const isToday = day === TODAY_DATE;
          const hasEvent = EVENT_DATES.has(day);
          const eventsOnDay = MOCK_EVENTS.filter((e) => e.date === day);
          return (
            <div
              key={day}
              role="gridcell"
              aria-label={`${MOCK_MONTH}月${day}日${isToday ? '（今日）' : ''}${hasEvent ? '、予定あり' : ''}`}
              style={{
                aspectRatio: '1',
                minHeight: 32,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                borderRadius: 8,
                background: isToday ? 'rgba(167,139,250,0.18)' : 'transparent',
                border: isToday ? '1px solid var(--noxa-accent-primary)' : '1px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                  color: isToday ? 'var(--noxa-accent-primary)' : 'var(--noxa-text-secondary)',
                  fontWeight: isToday ? 700 : 400,
                  lineHeight: 1,
                }}
              >
                {day}
              </span>
              {/* イベントドット（最大 3 種） */}
              {hasEvent && (
                <div style={{ display: 'flex', gap: 2, height: 5, alignItems: 'center' }} aria-hidden>
                  {eventsOnDay.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        background: KIND_META[e.kind].dot,
                        boxShadow: `0 0 4px ${KIND_META[e.kind].dot}`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 予定リストアイテム */
function EventItem({ ev }: { ev: ScheduleEvent }) {
  const meta = KIND_META[ev.kind];
  return (
    <li
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid var(--noxa-divider)',
        alignItems: 'flex-start',
      }}
    >
      {/* 左：日付インジケータ */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 36,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 2,
        }}
      >
        <span
          style={{
            fontFamily: mono,
            fontSize: 18,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            color: 'var(--noxa-text-primary)',
            lineHeight: 1,
          }}
        >
          {String(ev.date).padStart(2, '0')}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--noxa-text-faint)', letterSpacing: '0.06em' }}>
          6月
        </span>
      </div>

      {/* 中：タイムライン縦線 */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 6,
          gap: 4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: meta.dot,
            boxShadow: `0 0 8px ${meta.dot}`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            width: 1,
            flex: 1,
            minHeight: 24,
            background: 'var(--noxa-border)',
          }}
        />
      </div>

      {/* 右：詳細 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 種別バッジ + 時刻 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              background: meta.bg,
              border: `1px solid ${meta.dot}40`,
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: meta.text,
            }}
          >
            {meta.label}
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--noxa-text-muted)',
            }}
          >
            {ev.time}
            {ev.endTime && <> — {ev.endTime}</>}
          </span>
        </div>

        {/* タイトル */}
        <p
          style={{
            margin: '0 0 3px',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--noxa-text-primary)',
            lineHeight: 1.4,
          }}
        >
          {ev.title}
        </p>

        {/* 場所 */}
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
            letterSpacing: '0.04em',
          }}
        >
          📍 {ev.place}
        </p>
      </div>
    </li>
  );
}

// ──────────────────────────────────────────
// メインコンポーネント
// ──────────────────────────────────────────

export function ScheduleClient() {
  const upcomingEvents = MOCK_EVENTS.filter((e) => e.date >= TODAY_DATE).sort((a, b) => a.date - b.date || a.time.localeCompare(b.time));

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
      {/* 背景グロー（装飾） */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(167,139,250,0.07) 0%, transparent 65%)',
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
            <li>schedule</li>
          </ol>
        </nav>

        {/* ヘッダ */}
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
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Schedule</div>
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
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>スケジュール</span>
            </h1>
          </div>

          {/* モックバッジ */}
          <div
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
              color: 'var(--noxa-accent-secondary)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-accent-secondary)',
                boxShadow: '0 0 8px var(--noxa-accent-secondary)',
              }}
            />
            モックデータ
          </div>
        </div>

        {/* ──────────────────────────────── */}
        {/* 月カレンダー */}
        {/* ──────────────────────────────── */}
        <MonthCalendar />

        {/* ──────────────────────────────── */}
        {/* 今後の予定リスト */}
        {/* ──────────────────────────────── */}
        <section
          aria-label="今後の予定"
          style={{
            marginTop: 16,
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 18,
          }}
        >
          <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 4 }}>
            今後の予定
          </h2>
          <p
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: 'var(--noxa-text-faint)',
              margin: '0 0 14px',
              letterSpacing: '0.06em',
            }}
          >
            {MOCK_YEAR}年{MOCK_MONTH}月 · {upcomingEvents.length} 件
          </p>

          {upcomingEvents.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)' }}>今後の予定はありません。</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="予定一覧">
              {upcomingEvents.map((ev) => (
                <EventItem key={ev.id} ev={ev} />
              ))}
            </ul>
          )}
        </section>

        {/* フッタ注記 */}
        <p
          style={{
            margin: '16px 0 0',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
          }}
        >
          ※ 表示はモックデータです。実スケジュール連携は今後の実装予定。
        </p>
      </div>
    </div>
  );
}

export default ScheduleClient;
