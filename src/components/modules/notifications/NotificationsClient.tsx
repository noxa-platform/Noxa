'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * 通知センター — Noxa OS モジュール（モック）
 *
 * 誕生日 / 締め / シフト / 体験の4種別を色分けして表示する。
 * 未読ドット + クリックで既読トグル。実データ連携は将来実装。
 */

const mono = 'var(--noxa-font-mono)';

// 通知種別の定義
type NotifKind = 'birthday' | 'closing' | 'shift' | 'experience';

type Notif = {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  relativeTime: string;
};

// フィルタタブ
const TABS: { key: NotifKind | 'all'; label: string }[] = [
  { key: 'all',        label: 'すべて' },
  { key: 'birthday',   label: '誕生日' },
  { key: 'closing',    label: '締め' },
  { key: 'shift',      label: 'シフト' },
  { key: 'experience', label: '体験' },
];

// 種別ごとの色・ラベル設定
const KIND_META: Record<NotifKind, { label: string; color: string; bg: string; border: string }> = {
  birthday: {
    label: '誕生日',
    color:  'var(--noxa-status-warning)',
    bg:     'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.30)',
  },
  closing: {
    label:  '締め',
    color:  'var(--noxa-status-info)',
    bg:     'rgba(96,165,250,0.12)',
    border: 'rgba(96,165,250,0.30)',
  },
  shift: {
    label:  'シフト',
    color:  'var(--noxa-accent-violet, #a78bfa)',
    bg:     'rgba(167,139,250,0.12)',
    border: 'rgba(167,139,250,0.30)',
  },
  experience: {
    label:  '体験',
    color:  'var(--noxa-status-success)',
    bg:     'rgba(123,232,161,0.12)',
    border: 'rgba(123,232,161,0.30)',
  },
};

// 種別アイコン（テキスト絵文字で軽量実装）
const KIND_ICON: Record<NotifKind, string> = {
  birthday:   '🎂',
  closing:    '📋',
  shift:      '📅',
  experience: '✨',
};

// モック通知データ（10件）
const MOCK_NOTIFS: Notif[] = [
  { id: 'n01', kind: 'birthday',   title: '田中様の誕生日が3日後',       body: '田中 美咲様（誕: 6/5）へのメッセージ・プレゼント準備を忘れずに。',  relativeTime: '2時間前'   },
  { id: 'n02', kind: 'closing',    title: '本日の締め未完了',            body: '6/1（日）分の日報・売上記録がまだ入力されていません。',             relativeTime: '3時間前'   },
  { id: 'n03', kind: 'shift',      title: '明日のシフト確定',            body: '6/3（火）21:00〜25:00、担当: 木村・佐藤・橋本。',                  relativeTime: '5時間前'   },
  { id: 'n04', kind: 'experience', title: '体験 1名が 21:00 来店予定',   body: '鈴木 一郎様（初回体験）。担当スタッフを事前に決めておいてください。', relativeTime: '6時間前'   },
  { id: 'n05', kind: 'birthday',   title: '山本様の誕生日が7日後',       body: '山本 花子様（誕: 6/9）、去年は「桜」ボトルで喜ばれました。',       relativeTime: '昨日'      },
  { id: 'n06', kind: 'closing',    title: '5月の月次締め推奨',           body: '5月分の売上・顧客ランキングを確定する前に月次レポートを確認。',     relativeTime: '昨日'      },
  { id: 'n07', kind: 'shift',      title: 'シフト提出期限が明日',        body: '6/10〜6/15 の週次シフトをスタッフへ送信してください。',            relativeTime: '2日前'     },
  { id: 'n08', kind: 'experience', title: '体験リピート 2名が来店確定',  body: '先月体験の高橋様・中村様、21:30 来店。フォロー接客を準備。',       relativeTime: '2日前'     },
  { id: 'n09', kind: 'birthday',   title: '伊藤様の誕生日が本日',        body: '伊藤 健一様、本日お誕生日です。サプライズ演出は準備済みですか？',   relativeTime: '3日前'     },
  { id: 'n10', kind: 'shift',      title: 'スタッフ欠員アラート',        body: '6/4（水）に欠員が1名発生。代替要員を確認してください。',           relativeTime: '4日前'     },
];

export function NotificationsClient() {
  // アクティブフィルタ
  const [activeTab, setActiveTab] = useState<NotifKind | 'all'>('all');
  // 既読セット（IDで管理）
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const filteredNotifs = activeTab === 'all'
    ? MOCK_NOTIFS
    : MOCK_NOTIFS.filter((n) => n.kind === activeTab);

  const unreadCount = MOCK_NOTIFS.filter((n) => !readIds.has(n.id)).length;

  // クリックで既読トグル
  const handleNotifClick = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // すべて既読
  const handleMarkAllRead = () => {
    setReadIds(new Set(MOCK_NOTIFS.map((n) => n.id)));
  };

  return (
    <div
      style={{
        color:        'var(--noxa-text-primary)',
        fontFamily:   'var(--noxa-font-sans-jp)',
        borderRadius: 16,
        border:       '1px solid var(--noxa-border)',
        padding:      'clamp(16px, 3vw, 28px)',
        position:     'relative',
        overflow:     'hidden',
      }}
    >
      {/* 背景グロー */}
      <div
        aria-hidden
        style={{
          position:      'absolute',
          top:           '-30%',
          right:         '-10%',
          width:         640,
          height:        380,
          background:    'radial-gradient(ellipse, rgba(167,139,250,0.07) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>

        {/* breadcrumb */}
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol
            style={{
              display:    'flex',
              gap:        8,
              fontFamily: mono,
              fontSize:   11,
              letterSpacing: '0.06em',
              color:      'var(--noxa-text-faint)',
              listStyle:  'none',
              margin:     0,
              padding:    0,
            }}
          >
            <li>
              <Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li>notifications</li>
          </ol>
        </nav>

        {/* header */}
        <div
          style={{
            display:       'flex',
            alignItems:    'flex-end',
            justifyContent: 'space-between',
            gap:           16,
            flexWrap:      'wrap',
            marginBottom:  24,
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
              Noxa OS · Module 05 · Notifications
            </div>
            <h1
              className="noxa-display"
              style={{
                fontSize:   'clamp(26px, 4vw, 38px)',
                margin:     0,
                display:    'flex',
                alignItems: 'baseline',
                gap:        10,
                flexWrap:   'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontStyle:  'italic',
                  color:      'var(--noxa-accent-primary-ink)',
                  fontWeight: 400,
                }}
              >
                № 05
              </span>
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-jp)',
                  fontWeight: 500,
                }}
              >
                通知センター
              </span>
            </h1>
          </div>

          {/* 未読バッジ + すべて既読ボタン */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {unreadCount > 0 && (
              <div
                style={{
                  display:       'inline-flex',
                  alignItems:    'center',
                  gap:           6,
                  padding:       '5px 12px',
                  background:    'rgba(167,139,250,0.12)',
                  border:        '1px solid rgba(167,139,250,0.30)',
                  borderRadius:  9999,
                  fontFamily:    mono,
                  fontSize:      10,
                  letterSpacing: '0.12em',
                  color:         'var(--noxa-accent-violet, #a78bfa)',
                  textTransform: 'uppercase' as const,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width:        6,
                    height:       6,
                    borderRadius: 3,
                    background:   'var(--noxa-accent-violet, #a78bfa)',
                    boxShadow:    '0 0 6px var(--noxa-accent-violet, #a78bfa)',
                  }}
                />
                未読 {unreadCount}
              </div>
            )}
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background:    'transparent',
                  border:        '1px solid var(--noxa-border)',
                  borderRadius:  8,
                  padding:       '5px 12px',
                  fontFamily:    mono,
                  fontSize:      10,
                  letterSpacing: '0.08em',
                  color:         'var(--noxa-text-muted)',
                  cursor:        'pointer',
                  textTransform: 'uppercase' as const,
                  whiteSpace:    'nowrap' as const,
                }}
              >
                すべて既読
              </button>
            )}
          </div>
        </div>

        {/* フィルタタブ */}
        <div
          role="tablist"
          aria-label="通知フィルタ"
          style={{
            display:        'flex',
            gap:            4,
            marginBottom:   20,
            flexWrap:       'wrap' as const,
            overflowX:      'auto' as const,
            paddingBottom:  2,
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const tabUnread = tab.key === 'all'
              ? unreadCount
              : MOCK_NOTIFS.filter((n) => n.kind === tab.key && !readIds.has(n.id)).length;

            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display:       'inline-flex',
                  alignItems:    'center',
                  gap:           5,
                  padding:       '6px 14px',
                  borderRadius:  9999,
                  border:        isActive
                    ? '1px solid var(--noxa-accent-primary)'
                    : '1px solid var(--noxa-border)',
                  background:    isActive
                    ? 'rgba(103,232,249,0.10)'
                    : 'transparent',
                  fontFamily:    'var(--noxa-font-sans-jp)',
                  fontSize:      12,
                  color:         isActive
                    ? 'var(--noxa-accent-primary-ink)'
                    : 'var(--noxa-text-muted)',
                  cursor:        'pointer',
                  whiteSpace:    'nowrap' as const,
                  transition:    'all 0.15s',
                }}
              >
                {tab.label}
                {tabUnread > 0 && (
                  <span
                    style={{
                      background:   isActive ? 'var(--noxa-accent-primary)' : 'var(--noxa-text-faint)',
                      color:        'var(--noxa-bg-base, #0a0a0a)',
                      borderRadius: 9999,
                      fontFamily:   mono,
                      fontSize:     9,
                      padding:      '1px 5px',
                      lineHeight:   1.4,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {tabUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 通知リスト */}
        {filteredNotifs.length === 0 ? (
          <div
            style={{
              padding:    '40px 24px',
              textAlign:  'center' as const,
              color:      'var(--noxa-text-faint)',
              fontFamily: mono,
              fontSize:   12,
              letterSpacing: '0.06em',
            }}
          >
            このカテゴリの通知はありません
          </div>
        ) : (
          <ul
            style={{
              listStyle:      'none',
              margin:         0,
              padding:        0,
              display:        'flex',
              flexDirection:  'column' as const,
              gap:            8,
            }}
          >
            {filteredNotifs.map((notif) => {
              const isRead = readIds.has(notif.id);
              const meta   = KIND_META[notif.kind];

              return (
                <li key={notif.id}>
                  <button
                    onClick={() => handleNotifClick(notif.id)}
                    aria-label={`${notif.title}（${isRead ? '既読' : '未読'}）`}
                    style={{
                      width:      '100%',
                      textAlign:  'left' as const,
                      background: isRead ? 'transparent' : 'var(--noxa-surface-card)',
                      border:     `1px solid ${isRead ? 'var(--noxa-border)' : meta.border}`,
                      borderRadius: 14,
                      padding:    'clamp(12px, 2.5vw, 18px)',
                      cursor:     'pointer',
                      display:    'flex',
                      gap:        12,
                      alignItems: 'flex-start',
                      transition: 'all 0.15s',
                      opacity:    isRead ? 0.6 : 1,
                    }}
                  >
                    {/* 種別アイコン */}
                    <div
                      aria-hidden
                      style={{
                        width:        36,
                        height:       36,
                        borderRadius: 10,
                        flexShrink:   0,
                        background:   meta.bg,
                        border:       `1px solid ${meta.border}`,
                        display:      'flex',
                        alignItems:   'center',
                        justifyContent: 'center',
                        fontSize:     18,
                        marginTop:    1,
                      }}
                    >
                      {KIND_ICON[notif.kind]}
                    </div>

                    {/* 本文 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display:    'flex',
                          alignItems: 'flex-start',
                          gap:        8,
                          marginBottom: 4,
                          flexWrap:   'wrap' as const,
                        }}
                      >
                        {/* 種別バッジ */}
                        <span
                          style={{
                            fontFamily:    mono,
                            fontSize:      9,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase' as const,
                            color:         meta.color,
                            background:    meta.bg,
                            border:        `1px solid ${meta.border}`,
                            borderRadius:  4,
                            padding:       '2px 6px',
                            flexShrink:    0,
                            lineHeight:    1.5,
                          }}
                        >
                          {meta.label}
                        </span>

                        {/* タイトル */}
                        <span
                          style={{
                            fontSize:   13,
                            fontWeight: isRead ? 400 : 600,
                            color:      isRead ? 'var(--noxa-text-muted)' : 'var(--noxa-text-primary)',
                            lineHeight: 1.4,
                            flex:       1,
                            minWidth:   0,
                          }}
                        >
                          {notif.title}
                        </span>
                      </div>

                      <p
                        style={{
                          margin:     '0 0 6px',
                          fontSize:   12,
                          lineHeight: 1.6,
                          color:      'var(--noxa-text-muted)',
                        }}
                      >
                        {notif.body}
                      </p>

                      {/* 相対時刻 */}
                      <span
                        style={{
                          fontFamily:    mono,
                          fontSize:      10,
                          color:         'var(--noxa-text-faint)',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {notif.relativeTime}
                      </span>
                    </div>

                    {/* 未読ドット */}
                    <div
                      aria-hidden
                      style={{
                        width:        8,
                        height:       8,
                        borderRadius: 4,
                        background:   isRead ? 'transparent' : meta.color,
                        boxShadow:    isRead ? 'none' : `0 0 6px ${meta.color}`,
                        flexShrink:   0,
                        marginTop:    6,
                        transition:   'all 0.15s',
                      }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* フッターノート */}
        <p
          style={{
            margin:        '20px 0 0',
            fontSize:      11,
            lineHeight:    1.6,
            color:         'var(--noxa-text-faint)',
            fontFamily:    mono,
            letterSpacing: '0.04em',
          }}
        >
          ※ 現在モックデータを表示中。実通知は Firestore noxa-platform より配信予定。
        </p>
      </div>
    </div>
  );
}

export default NotificationsClient;
