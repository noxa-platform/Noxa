'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ⑥ 初回案内 — First Visit UI モック（ガワのみ）
 *
 * ロジック・永続化なし。チェック状態とタブ切替のみ useState。
 * 3セクション:
 *   1. 新人チェックリスト（カテゴリ別 + 進捗バー）
 *   2. 暗記カード（タブ切替: 料金体系/メニュー/ボトル紹介/指名トーク）
 *   3. OJT進捗（店長ビュー: 新人3名のカード一覧）
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

type CheckItem = {
  id: string;
  label: string;
  category: 'belongings' | 'dress' | 'ng' | 'pricing';
};

const CATEGORY_META: Record<CheckItem['category'], { label: string; color: string }> = {
  belongings: { label: '持ち物', color: 'var(--noxa-status-info)' },
  dress: { label: '服装', color: 'var(--noxa-accent-primary-ink)' },
  ng: { label: '接客 NG', color: 'var(--noxa-status-warning)' },
  pricing: { label: '料金理解', color: 'var(--noxa-status-success)' },
};

const MOCK_CHECKLIST: CheckItem[] = [
  { id: 'c1', label: '身分証明書 (成人確認)', category: 'belongings' },
  { id: 'c2', label: 'ヒール / 靴（指定なし可）', category: 'belongings' },
  { id: 'c3', label: 'ロッカー用南京錠', category: 'belongings' },
  { id: 'c4', label: 'ドレスコードを満たした衣装', category: 'dress' },
  { id: 'c5', label: 'ネイル・香水は控えめに', category: 'dress' },
  { id: 'c6', label: 'SNS で店内を無断撮影しない', category: 'ng' },
  { id: 'c7', label: '客への連絡先交換 — 店外NG', category: 'ng' },
  { id: 'c8', label: '泥酔・バックヤードへの案内 NG', category: 'ng' },
  { id: 'c9', label: 'セット料金を暗記している', category: 'pricing' },
  { id: 'c10', label: '指名料・延長料の案内ができる', category: 'pricing' },
  { id: 'c11', label: 'ボトルキープの仕組みを理解した', category: 'pricing' },
  { id: 'c12', label: '同伴・場内指名の定義を知っている', category: 'pricing' },
];

// 初期完了状態（8/12 = 67%）
const INITIAL_CHECKED = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c9']);

// ─── 暗記カードタブ ───

type CardTab = 'pricing' | 'menu' | 'bottle' | 'nomination';

const CARD_TABS: { id: CardTab; label: string }[] = [
  { id: 'pricing', label: '料金体系' },
  { id: 'menu', label: 'メニュー' },
  { id: 'bottle', label: 'ボトル紹介' },
  { id: 'nomination', label: '指名トーク' },
];

type CardItem = { front: string; back: string };

const MOCK_CARDS: Record<CardTab, CardItem[]> = {
  pricing: [
    { front: 'セット料金（60分）とは？', back: '¥5,000 — 飲み放題 + キャスト1名の接客込みの基本コース' },
    { front: '延長料金は？', back: '30分ごとに ¥3,000 加算。キャスト1名追加は別途 ¥2,000' },
    { front: '指名料とは？', back: '特定キャストを指名した際に発生する追加料金 ¥3,000' },
    { front: '同伴料とは？', back: 'キャストが来店前に客と食事等をした場合に発生 ¥5,000' },
    { front: '場内指名とは？', back: '店内で気に入ったキャストを指名。¥2,000 / 1回' },
    { front: 'サービス料とは？', back: '飲食代合計の 15%。別途消費税 10% が加算される' },
  ],
  menu: [
    { front: 'ソフトドリンクの種類は？', back: 'ウーロン茶・ジュース・炭酸水 等。セット料金内で提供' },
    { front: '人気カクテル TOP3', back: '1. カシスオレンジ  2. ジントニック  3. ファジーネーブル' },
    { front: 'フードの定番は？', back: '枝豆・ミックスナッツ・チーズ盛り合わせ。深夜は特製カレーも人気' },
    { front: 'シャンパングラス と ボトルの違い', back: 'グラス: ¥2,000〜。ボトル: ¥12,000〜（数名でシェア可）' },
  ],
  bottle: [
    { front: '鏡月ボトル', back: '¥12,000 / キープ2ヶ月。韓国焼酎。コスパ最良で初指名客に人気' },
    { front: 'モエ ロゼ', back: '¥30,000 / 750ml。祝宴・バースデーに定番。乾杯演出あり' },
    { front: 'ヴーヴ・クリコ', back: '¥45,000。イエローラベルが定番。プレミア感を演出しやすい' },
    { front: 'ドンペリ 白', back: '¥80,000〜。売上インセンティブ最大。開栓時に全員で祝う演出が必須' },
  ],
  nomination: [
    { front: '場内指名を断られた時は？', back: '「また次回ぜひ」と笑顔でお礼。強引にせず次の機会を作る' },
    { front: '指名を受けた時の第一声', back: '「ありがとうございます！精一杯楽しんでいただきます♪」' },
    { front: '同伴を誘う際の基本フレーズ', back: '「来店前に少しだけご一緒できれば嬉しいです。ご都合いかがですか？」' },
    { front: '延長を促すタイミング', back: '残り10分前後。「もう少しお話ししたいですが、いかがですか？」' },
  ],
};

// ─── OJT 進捗 ───

type OjtMember = {
  id: string;
  name: string;
  progress: number; // 0–100
  phase: string;
  joinDate: string;
  mentor: string;
};

const MOCK_OJT: OjtMember[] = [
  { id: 'oj1', name: 'ひより', progress: 92, phase: '最終確認', joinDate: '2026-05-12', mentor: '玲奈' },
  { id: 'oj2', name: 'みお', progress: 67, phase: '暗記カード習得中', joinDate: '2026-05-26', mentor: '美咲' },
  { id: 'oj3', name: 'ことな', progress: 30, phase: '初日チェック完了', joinDate: '2026-06-01', mentor: '玲奈' },
];

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function FirstVisitClient() {
  // チェックリスト状態
  const [checked, setChecked] = useState<Set<string>>(new Set(INITIAL_CHECKED));
  // 暗記カードタブ
  const [activeTab, setActiveTab] = useState<CardTab>('pricing');
  // フリップ済みカードID
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFlip = (id: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const total = MOCK_CHECKLIST.length;
  const done = MOCK_CHECKLIST.filter((c) => checked.has(c.id)).length;
  const progressPct = Math.round((done / total) * 100);

  const categories = (Object.keys(CATEGORY_META) as CheckItem['category'][]);

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
          right: '-8%',
          width: 640,
          height: 380,
          background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.12) 0%, transparent 65%)',
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
              <li>first-visit</li>
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
                Noxa OS · Module 06 · First Visit
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
                  № 06
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  初回案内
                </span>
              </h1>
            </div>

            {/* モックバッジ */}
            <div
              role="note"
              aria-label="このモジュールはモックです"
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
              UI モック · データ保存なし
            </div>
          </div>
        </header>

        {/* ─ 2カラムレイアウト（左: チェックリスト、右: カード + OJT） ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_1fr]"
          style={{ gap: 'clamp(14px, 2vw, 20px)', alignItems: 'start' }}
        >
          {/* ─── 左：新人チェックリスト ─── */}
          <section aria-label="新人チェックリスト">
            <SectionTitle>新人チェックリスト</SectionTitle>

            {/* 進捗バー */}
            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: '16px 18px',
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 13,
                    color: 'var(--noxa-text-muted)',
                  }}
                >
                  チェック完了
                </span>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 20,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--noxa-text-primary)',
                  }}
                >
                  {done}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: 'var(--noxa-text-muted)',
                      marginLeft: 2,
                    }}
                  >
                    / {total}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--noxa-accent-primary-ink)',
                      marginLeft: 8,
                    }}
                  >
                    {progressPct}%
                  </span>
                </span>
              </div>

              {/* バー本体 */}
              <div
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`チェックリスト進捗 ${progressPct}%`}
                style={{
                  height: 8,
                  borderRadius: 9999,
                  background: 'var(--noxa-surface-muted)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    borderRadius: 9999,
                    background:
                      'linear-gradient(90deg, var(--noxa-accent-primary), var(--noxa-accent-primary-neon))',
                    boxShadow: 'var(--noxa-glow-soft)',
                    transition: 'width 0.4s var(--noxa-ease-natural)',
                  }}
                />
              </div>
            </div>

            {/* カテゴリ別チェックリスト */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {categories.map((cat) => {
                const meta = CATEGORY_META[cat];
                const items = MOCK_CHECKLIST.filter((c) => c.category === cat);
                return (
                  <div
                    key={cat}
                    style={{
                      background: 'var(--noxa-surface-card)',
                      border: '1px solid var(--noxa-border)',
                      borderRadius: 14,
                      padding: '14px 16px',
                    }}
                  >
                    {/* カテゴリヘッダー */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                        paddingBottom: 8,
                        borderBottom: '1px solid var(--noxa-divider)',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          background: meta.color,
                          boxShadow: `0 0 8px ${meta.color}`,
                          flex: 'none',
                        }}
                      />
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: meta.color,
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>

                    {/* チェック項目リスト */}
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {items.map((item) => {
                        const isChecked = checked.has(item.id);
                        return (
                          <li key={item.id}>
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                minHeight: 44,
                                padding: '4px 4px',
                                cursor: 'pointer',
                                borderRadius: 8,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCheck(item.id)}
                                aria-label={item.label}
                                style={{
                                  appearance: 'none',
                                  WebkitAppearance: 'none',
                                  width: 20,
                                  height: 20,
                                  borderRadius: 6,
                                  border: isChecked
                                    ? '2px solid var(--noxa-accent-primary)'
                                    : '2px solid var(--noxa-border-strong)',
                                  background: isChecked
                                    ? 'var(--noxa-accent-primary)'
                                    : 'transparent',
                                  flex: 'none',
                                  cursor: 'pointer',
                                  boxShadow: isChecked ? 'var(--noxa-glow-ring)' : 'none',
                                  transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                                  position: 'relative',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              />
                              {/* チェックマーク (SVG) */}
                              {isChecked && (
                                <svg
                                  aria-hidden
                                  width="12"
                                  height="9"
                                  viewBox="0 0 12 9"
                                  fill="none"
                                  style={{ position: 'absolute', marginLeft: 4, pointerEvents: 'none' }}
                                >
                                  <path
                                    d="M1 4.5L4.5 8L11 1"
                                    stroke="#fff"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                              <span
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.5,
                                  color: isChecked
                                    ? 'var(--noxa-text-muted)'
                                    : 'var(--noxa-text-primary)',
                                  textDecoration: isChecked ? 'line-through' : 'none',
                                  transition: 'color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                                }}
                              >
                                {item.label}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── 右：暗記カード + OJT進捗 ─── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 暗記カード */}
            <section aria-label="暗記カード">
              <SectionTitle>暗記カード</SectionTitle>

              <div
                style={{
                  background: 'var(--noxa-surface-card)',
                  border: '1px solid var(--noxa-border)',
                  borderRadius: 16,
                  padding: '16px 18px',
                }}
              >
                {/* タブ */}
                <div
                  role="tablist"
                  aria-label="暗記カードカテゴリ"
                  style={{
                    display: 'flex',
                    gap: 6,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    marginBottom: 14,
                  }}
                >
                  {CARD_TABS.map((t) => {
                    const active = t.id === activeTab;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setActiveTab(t.id);
                          setFlipped(new Set()); // タブ切替でフリップリセット
                        }}
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
                          background: active ? 'var(--noxa-accent-primary)' : 'transparent',
                          color: active ? '#fff' : 'var(--noxa-text-muted)',
                          border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
                          boxShadow: active ? 'var(--noxa-glow-soft)' : 'none',
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                        }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {/* カード一覧 */}
                <div
                  role="tabpanel"
                  aria-label={`${CARD_TABS.find((t) => t.id === activeTab)?.label}カード一覧`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {MOCK_CARDS[activeTab].map((card, i) => {
                    const cardId = `${activeTab}-${i}`;
                    const isFlipped = flipped.has(cardId);
                    return (
                      <button
                        key={cardId}
                        type="button"
                        onClick={() => toggleFlip(cardId)}
                        aria-pressed={isFlipped}
                        aria-label={`カード: ${card.front}${isFlipped ? '（答え表示中）' : '（タップで答えを見る）'}`}
                        style={{
                          appearance: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          minHeight: 72,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: isFlipped
                            ? 'rgba(139, 92, 246, 0.08)'
                            : 'var(--noxa-surface-muted)',
                          border: `1px solid ${
                            isFlipped ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'
                          }`,
                          color: 'var(--noxa-text-primary)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          boxShadow: isFlipped ? 'var(--noxa-glow-ring)' : 'none',
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                        }}
                      >
                        {/* 表: 質問 */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 9,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: isFlipped
                                ? 'var(--noxa-accent-primary-ink)'
                                : 'var(--noxa-text-faint)',
                              flex: 'none',
                            }}
                          >
                            {isFlipped ? 'ANS' : 'Q'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}>
                            {isFlipped ? card.back : card.front}
                          </span>
                        </div>

                        {/* 裏へのヒント（未フリップ時） */}
                        {!isFlipped && (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--noxa-text-faint)',
                              fontFamily: mono,
                              letterSpacing: '0.06em',
                            }}
                          >
                            タップして答えを確認 →
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* OJT 進捗（店長ビュー） */}
            <section aria-label="OJT進捗">
              <SectionTitle>OJT 進捗 — 店長ビュー</SectionTitle>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {MOCK_OJT.map((member) => (
                  <div
                    key={member.id}
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
                    {/* ヘッダー行 */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* アバター */}
                        <div
                          aria-hidden
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            background:
                              'linear-gradient(135deg, var(--noxa-accent-primary), var(--noxa-accent-primary-neon))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'var(--noxa-font-display-jp)',
                            fontSize: 14,
                            fontWeight: 600,
                            color: '#fff',
                            flex: 'none',
                            boxShadow: 'var(--noxa-glow-soft)',
                          }}
                        >
                          {member.name[0]}
                        </div>
                        <div>
                          <div
                            style={{
                              fontFamily: 'var(--noxa-font-display-jp)',
                              fontSize: 15,
                              fontWeight: 500,
                              color: 'var(--noxa-text-primary)',
                            }}
                          >
                            {member.name}
                          </div>
                          <div
                            style={{
                              fontFamily: mono,
                              fontSize: 10,
                              color: 'var(--noxa-text-faint)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            入店 {member.joinDate} · 担当 {member.mentor}
                          </div>
                        </div>
                      </div>

                      {/* 進捗% */}
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 22,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color:
                            member.progress >= 80
                              ? 'var(--noxa-status-success)'
                              : member.progress >= 50
                                ? 'var(--noxa-accent-primary-ink)'
                                : 'var(--noxa-status-warning)',
                        }}
                      >
                        {member.progress}%
                      </span>
                    </div>

                    {/* フェーズラベル */}
                    <div
                      style={{
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        fontSize: 12,
                        color: 'var(--noxa-text-muted)',
                      }}
                    >
                      フェーズ: {member.phase}
                    </div>

                    {/* 進捗バー */}
                    <div
                      role="progressbar"
                      aria-valuenow={member.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${member.name}のOJT進捗 ${member.progress}%`}
                      style={{
                        height: 6,
                        borderRadius: 9999,
                        background: 'var(--noxa-surface-muted)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${member.progress}%`,
                          borderRadius: 9999,
                          background:
                            member.progress >= 80
                              ? 'linear-gradient(90deg, var(--noxa-status-success), #A0F5C0)'
                              : 'linear-gradient(90deg, var(--noxa-accent-primary), var(--noxa-accent-primary-neon))',
                          boxShadow: 'var(--noxa-glow-soft)',
                          transition: 'width 0.4s var(--noxa-ease-natural)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

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

export default FirstVisitClient;
