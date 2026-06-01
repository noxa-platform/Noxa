'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ④ 勤怠管理 — 打刻 / シフトカレンダー / 月間サマリ / スタッフ一覧 UI モック（ガワのみ）
 *
 * ロジック・永続化なし。すべて MOCK_* のモックデータ。
 * UI 内部 state（出勤/退勤トグル・カレンダー選択日）のみ useState で実装。
 * ボタンは no-op。new Date() 禁止 → モック固定値使用。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

/** スタッフの本日出勤状況 */
type AttendanceStatus = 'in' | 'absent' | 'late';

type MockStaff = {
  id: string;
  name: string;
  role: string;
  status: AttendanceStatus;
  clockIn?: string; // 出勤打刻時刻（モック固定）
  scheduledIn: string; // 予定出勤時刻
};

const MOCK_STAFF: MockStaff[] = [
  { id: 'S1', name: '凛', role: 'キャスト', status: 'in', clockIn: '21:03', scheduledIn: '21:00' },
  { id: 'S2', name: '葵', role: 'キャスト', status: 'late', clockIn: '22:48', scheduledIn: '22:00' },
  { id: 'S3', name: '蘭', role: 'キャスト', status: 'in', clockIn: '20:58', scheduledIn: '21:00' },
  { id: 'S4', name: 'ゆい', role: 'キャスト', status: 'absent', scheduledIn: '21:00' },
  { id: 'S5', name: 'みれい', role: 'キャスト', status: 'in', clockIn: '21:15', scheduledIn: '21:00' },
  { id: 'S6', name: '店長', role: 'マネージャ', status: 'in', clockIn: '19:30', scheduledIn: '19:30' },
];

/** 今月の出勤実績（日付 = 月内 day 番号） */
const MOCK_ATTENDED_DAYS = new Set([1, 2, 3, 5, 6, 7, 8, 9, 12, 14, 15, 16, 17, 19, 21, 22, 23, 26]);

/** 月間サマリ */
const MOCK_SUMMARY = {
  workedDays: 18,
  totalHours: '97:20',
  lateCount: 1,
  absentCount: 0,
};

/** カレンダー表示用（2025年6月を想定。1日=日曜） */
const MOCK_CALENDAR = {
  year: 2025,
  month: 6, // 1-indexed
  firstDayOfWeek: 0, // 0=日曜
  daysInMonth: 30,
  today: 2, // 本日 = 2日（モック固定）
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

const ATTENDANCE_STATUS_META: Record<AttendanceStatus, { label: string; color: string }> = {
  in: { label: '出勤中', color: 'var(--noxa-status-success)' },
  absent: { label: '未出勤', color: 'var(--noxa-status-error)' },
  late: { label: '遅刻', color: 'var(--noxa-status-warning)' },
};

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function AttendanceClient() {
  /** 出勤中か退勤中かのトグル（UI state のみ） */
  const [isClockIn, setIsClockIn] = useState(true);
  /** カレンダーで選択中の日（モック） */
  const [selectedDay, setSelectedDay] = useState<number>(MOCK_CALENDAR.today);

  const { firstDayOfWeek, daysInMonth, today } = MOCK_CALENDAR;

  // カレンダーセルの配列を生成（空白セル + 日付セル）
  const calendarCells: (number | null)[] = [
    ...Array.from({ length: firstDayOfWeek }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

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
          top: '-25%',
          left: '-5%',
          width: 600,
          height: 400,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-20%',
          right: '-8%',
          width: 500,
          height: 350,
          background: 'radial-gradient(ellipse, rgba(123, 232, 161, 0.06) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ header ─ */}
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
                <Link href="/" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                  Noxa OS
                </Link>
              </li>
              <li aria-hidden>·</li>
              <li>attendance</li>
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
                Noxa OS · Module 04 · Attendance
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
                  № 04
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  勤怠
                </span>
              </h1>
            </div>

            {/* モックバッジ */}
            <div
              role="note"
              aria-label="このモジュールはUIモックです"
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
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--noxa-accent-primary-ink)',
                }}
              />
              UI Mock · ロジックなし
            </div>
          </div>
        </header>

        {/* ─ 打刻ヒーロー ─ */}
        <section
          aria-label="打刻"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border-strong)',
            borderRadius: 20,
            padding: 'clamp(20px, 3vw, 32px)',
            marginBottom: 'clamp(16px, 2.4vw, 24px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* ヒーロー内グロー */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: '-40%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 500,
              height: 300,
              background: isClockIn
                ? 'radial-gradient(ellipse, rgba(123, 232, 161, 0.12) 0%, transparent 65%)'
                : 'radial-gradient(ellipse, rgba(139, 92, 246, 0.10) 0%, transparent 65%)',
              pointerEvents: 'none',
              transition: 'background 0.4s ease',
            }}
          />

          {/* 現在時刻（モック固定値） */}
          <time
            aria-label="現在時刻 23:14"
            style={{
              fontFamily: 'var(--noxa-font-display-en)',
              fontSize: 'clamp(56px, 10vw, 96px)',
              fontWeight: 300,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              color: 'var(--noxa-text-primary)',
              lineHeight: 1,
              position: 'relative',
            }}
          >
            23:14
          </time>

          {/* 今日の状態 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: mono,
              fontSize: 13,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: isClockIn ? 'var(--noxa-status-success)' : 'var(--noxa-text-faint)',
                boxShadow: isClockIn ? '0 0 10px var(--noxa-status-success)' : 'none',
                transition: 'all 0.3s var(--noxa-ease-natural)',
                flex: 'none',
              }}
            />
            <span
              style={{
                color: isClockIn ? 'var(--noxa-status-success)' : 'var(--noxa-text-muted)',
                transition: 'color 0.3s var(--noxa-ease-natural)',
              }}
            >
              {isClockIn ? '出勤中 since 21:00' : '退勤済 · 本日の勤務終了'}
            </span>
          </div>

          {/* 打刻トグルボタン */}
          <button
            type="button"
            onClick={() => setIsClockIn((prev) => !prev)}
            aria-pressed={isClockIn}
            aria-label={isClockIn ? '退勤する' : '出勤する'}
            style={{
              appearance: 'none',
              cursor: 'pointer',
              minHeight: 56,
              minWidth: 220,
              padding: '0 32px',
              borderRadius: 9999,
              fontFamily: 'var(--noxa-font-sans-jp)',
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '0.06em',
              border: isClockIn
                ? '1px solid rgba(196, 56, 74, 0.70)'
                : '1px solid var(--noxa-accent-primary)',
              background: isClockIn
                ? 'rgba(196, 56, 74, 0.15)'
                : 'var(--noxa-accent-primary)',
              color: isClockIn ? 'var(--noxa-status-error)' : '#fff',
              boxShadow: isClockIn
                ? '0 0 20px rgba(196, 56, 74, 0.25)'
                : 'var(--noxa-glow-strong)',
              transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
              position: 'relative',
            }}
          >
            {isClockIn ? '退勤する' : '出勤する'}
          </button>

          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              fontFamily: mono,
            }}
          >
            ※ モック固定値 · 実際の打刻は保存されません
          </p>
        </section>

        {/* ─ 中段：カレンダー + サマリ ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_300px]"
          style={{ gap: 'clamp(12px, 1.6vw, 18px)', marginBottom: 'clamp(16px, 2.4vw, 24px)', alignItems: 'start' }}
        >
          {/* 月間シフトカレンダー */}
          <section
            aria-label="月間シフトカレンダー"
            style={{
              background: 'var(--noxa-surface-card)',
              border: '1px solid var(--noxa-border)',
              borderRadius: 16,
              padding: 'clamp(16px, 2.4vw, 24px)',
            }}
          >
            <SectionTitle>月間シフト</SectionTitle>

            {/* カレンダーヘッダー */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-jp)',
                  fontSize: 18,
                  fontWeight: 500,
                  color: 'var(--noxa-text-primary)',
                }}
              >
                2025年6月
              </span>
              {/* ナビは no-op */}
              <div style={{ display: 'flex', gap: 6 }}>
                {['‹', '›'].map((arrow) => (
                  <button
                    key={arrow}
                    type="button"
                    onClick={() => { /* no-op */ }}
                    aria-label={arrow === '‹' ? '前月' : '翌月'}
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'var(--noxa-surface-muted)',
                      border: '1px solid var(--noxa-border)',
                      color: 'var(--noxa-text-muted)',
                      fontSize: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {arrow}
                  </button>
                ))}
              </div>
            </div>

            {/* 曜日ヘッダー */}
            <div
              aria-hidden
              className="grid grid-cols-7"
              style={{ marginBottom: 8, gap: 4 }}
            >
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  style={{
                    textAlign: 'center',
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    color: i === 0
                      ? 'var(--noxa-status-error)'
                      : i === 6
                        ? 'var(--noxa-accent-primary-ink)'
                        : 'var(--noxa-text-faint)',
                    paddingBottom: 4,
                  }}
                >
                  {w}
                </div>
              ))}
            </div>

            {/* 日付グリッド */}
            <div className="grid grid-cols-7" style={{ gap: 4 }}>
              {calendarCells.map((day, idx) => {
                if (day === null) {
                  return <div key={`blank-${idx}`} aria-hidden />;
                }
                const isToday = day === today;
                const isAttended = MOCK_ATTENDED_DAYS.has(day);
                const isSelected = day === selectedDay;
                const dayOfWeek = (firstDayOfWeek + day - 1) % 7;

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-label={`6月${day}日${isAttended ? ' 出勤' : ''}${isToday ? ' 今日' : ''}`}
                    aria-pressed={isSelected}
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      minHeight: 44,
                      borderRadius: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      background: isToday
                        ? 'rgba(139, 92, 246, 0.20)'
                        : isSelected
                          ? 'var(--noxa-surface-hover)'
                          : 'transparent',
                      border: isToday
                        ? '1px solid var(--noxa-accent-primary)'
                        : isSelected
                          ? '1px solid var(--noxa-border-strong)'
                          : '1px solid transparent',
                      boxShadow: isToday ? 'var(--noxa-glow-ring)' : 'none',
                      transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 13,
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: isToday ? 700 : 400,
                        color: isToday
                          ? 'var(--noxa-accent-primary-neon)'
                          : dayOfWeek === 0
                            ? 'var(--noxa-status-error)'
                            : dayOfWeek === 6
                              ? 'var(--noxa-accent-primary-ink)'
                              : 'var(--noxa-text-primary)',
                      }}
                    >
                      {day}
                    </span>
                    {/* 出勤ドット */}
                    {isAttended && (
                      <span
                        aria-hidden
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          background: 'var(--noxa-accent-primary)',
                          boxShadow: '0 0 6px var(--noxa-accent-primary)',
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 凡例 */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid var(--noxa-divider)',
                flexWrap: 'wrap',
              }}
            >
              {[
                { dot: 'var(--noxa-accent-primary)', label: '出勤実績' },
                { dot: 'var(--noxa-accent-primary-neon)', label: '今日', ring: true },
              ].map(({ dot, label, ring }) => (
                <div
                  key={label}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: dot,
                      boxShadow: ring ? `0 0 8px ${dot}` : 'none',
                      flex: 'none',
                    }}
                  />
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 11,
                      color: 'var(--noxa-text-faint)',
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 月間サマリ */}
          <section aria-label="今月サマリ">
            <SectionTitle>今月サマリ</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryCard
                label="出勤日数"
                value={`${MOCK_SUMMARY.workedDays}日`}
                valueColor="var(--noxa-text-primary)"
                note="/ 30日"
              />
              <SummaryCard
                label="総勤務時間"
                value={MOCK_SUMMARY.totalHours}
                valueColor="var(--noxa-accent-primary-ink)"
                note="h"
              />
              <SummaryCard
                label="遅刻回数"
                value={`${MOCK_SUMMARY.lateCount}回`}
                valueColor={
                  MOCK_SUMMARY.lateCount > 0
                    ? 'var(--noxa-status-warning)'
                    : 'var(--noxa-status-success)'
                }
              />
              <SummaryCard
                label="欠勤回数"
                value={`${MOCK_SUMMARY.absentCount}回`}
                valueColor={
                  MOCK_SUMMARY.absentCount > 0
                    ? 'var(--noxa-status-error)'
                    : 'var(--noxa-status-success)'
                }
              />
            </div>

            {/* ⑤ 給与連携ヒント */}
            <div
              role="note"
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid var(--noxa-divider)',
                borderRadius: 12,
                fontFamily: mono,
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--noxa-text-faint)',
              }}
            >
              ⑤ 給与計算モジュールへ自動連携予定。遅刻・欠勤は控除ルールに反映。
            </div>
          </section>
        </div>

        {/* ─ スタッフ一覧（店長ビュー） ─ */}
        <section aria-label="スタッフ本日出勤状況（店長ビュー）">
          <SectionTitle>スタッフ状況（本日）</SectionTitle>
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
              aria-hidden
              className="grid grid-cols-[1fr_80px_80px_80px]"
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--noxa-divider)',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              {['スタッフ', '予定', '打刻', '状態'].map((h) => (
                <span
                  key={h}
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-faint)',
                  }}
                >
                  {h}
                </span>
              ))}
            </div>

            {/* スタッフ行 */}
            <ul
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
              role="list"
            >
              {MOCK_STAFF.map((staff, i) => {
                const meta = ATTENDANCE_STATUS_META[staff.status];
                return (
                  <li
                    key={staff.id}
                    className="grid grid-cols-[1fr_80px_80px_80px]"
                    style={{
                      padding: '14px 16px',
                      borderBottom:
                        i < MOCK_STAFF.length - 1
                          ? '1px solid var(--noxa-divider)'
                          : 'none',
                      alignItems: 'center',
                    }}
                  >
                    {/* 名前 + 役職 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      {/* アバター */}
                      <div
                        aria-hidden
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 9999,
                          background: 'var(--noxa-surface-muted)',
                          border: '1px solid var(--noxa-border-strong)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--noxa-font-display-jp)',
                          fontSize: 13,
                          color: 'var(--noxa-accent-primary-ink)',
                          flex: 'none',
                        }}
                      >
                        {staff.name[0]}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: 'var(--noxa-text-primary)',
                          }}
                        >
                          {staff.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--noxa-text-faint)',
                            fontFamily: mono,
                          }}
                        >
                          {staff.role}
                        </div>
                      </div>
                    </div>

                    {/* 予定出勤 */}
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 13,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--noxa-text-muted)',
                      }}
                    >
                      {staff.scheduledIn}
                    </span>

                    {/* 打刻時刻 */}
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 13,
                        fontVariantNumeric: 'tabular-nums',
                        color: staff.clockIn
                          ? 'var(--noxa-text-primary)'
                          : 'var(--noxa-text-faint)',
                      }}
                    >
                      {staff.clockIn ?? '—'}
                    </span>

                    {/* ステータスバッジ */}
                    <div>
                      <span
                        role="status"
                        aria-label={`${staff.name}の出勤状態: ${meta.label}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '4px 10px',
                          borderRadius: 9999,
                          background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${meta.color} 40%, transparent)`,
                          fontFamily: mono,
                          fontSize: 11,
                          fontWeight: 600,
                          color: meta.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 3,
                            background: meta.color,
                            boxShadow:
                              staff.status === 'in'
                                ? `0 0 6px ${meta.color}`
                                : 'none',
                            flex: 'none',
                          }}
                        />
                        {meta.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* フッターメモ */}
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--noxa-divider)',
                fontFamily: mono,
                fontSize: 11,
                color: 'var(--noxa-text-faint)',
              }}
            >
              ※ 店長ビュー · リアルタイム連携は未実装。モックデータ表示。
            </div>
          </div>
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
      style={{ fontSize: 11, marginBottom: 12, display: 'block' }}
    >
      {children}
    </h2>
  );
}

function SummaryCard({
  label,
  value,
  valueColor,
  note,
}: {
  label: string;
  value: string;
  valueColor: string;
  note?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: 'var(--noxa-text-muted)',
          fontFamily: 'var(--noxa-font-sans-jp)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--noxa-font-display-en)',
            fontStyle: 'italic',
            fontSize: 26,
            fontWeight: 400,
            fontVariantNumeric: 'tabular-nums',
            color: valueColor,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {note && (
          <span
            style={{
              fontFamily: 'var(--noxa-font-mono)',
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
            }}
          >
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

export default AttendanceClient;
