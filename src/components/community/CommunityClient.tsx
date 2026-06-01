'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * サブ機能 A — 夜職専用紹介制コミュニティ（クローズド SNS）
 *
 * タイムライン UI ガワのみ。投稿・リアクションはすべて no-op。
 * モックデータのみ使用。永続化・API 通信なし。
 */

// ─────────────────────────────────────────────
// 定数・モックデータ
// ─────────────────────────────────────────────

const mono = 'var(--noxa-font-mono)';
const fontJp = 'var(--noxa-font-sans-jp)';
const fontDisplay = 'var(--noxa-font-display-jp)';

type MockPost = {
  id: string;
  authorName: string;        // 匿名ニックネーム
  authorInitial: string;     // アバター表示用頭文字
  authorColor: string;       // アバター背景色（CSS 変数）
  postedAt: string;          // 相対表記
  body: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
};

const MOCK_POSTS: MockPost[] = [
  {
    id: 'p1',
    authorName: '夜の蝶 A',
    authorInitial: '蝶',
    authorColor: 'var(--noxa-accent-primary)',
    postedAt: '32分前',
    body: '出勤前のスキンケアにかける時間、みなさんどのくらいですか。最近ベースを変えてからツキが上がった気がしていて、少し時間を延ばしています。朝型にシフトしてから日中に時間が取れるようになったのが大きいです。',
    tags: ['日記', '美容'],
    likeCount: 24,
    commentCount: 7,
  },
  {
    id: 'p2',
    authorName: 'ミナミの住人',
    authorInitial: '住',
    authorColor: 'var(--noxa-accent-primary-ink)',
    postedAt: '1時間前',
    body: '太客の誕生日フォロー、みなさん何をされていますか。手書きのメッセージを続けているのですが、最近は小さなギフトを添えるようにしたところ反応がかなり違いました。個人的には気持ちが伝わる形にこだわっています。',
    tags: ['同伴', '接客'],
    likeCount: 41,
    commentCount: 12,
  },
  {
    id: 'p3',
    authorName: 'Sora.night',
    authorInitial: 'S',
    authorColor: '#67E8F9',
    postedAt: '3時間前',
    body: '指名が続いているお客様から他の店舗でも会いたいと言われたとき、どう対応するかいつも迷います。お店のルールもあるので慎重にしていますが、関係性を壊さない言い回しがあればぜひ教えてください。',
    tags: ['指名', '接客'],
    likeCount: 18,
    commentCount: 5,
  },
  {
    id: 'p4',
    authorName: '深夜シフト隊長',
    authorInitial: '隊',
    authorColor: 'var(--noxa-status-warning)',
    postedAt: '5時間前',
    body: '深夜 2 時を過ぎてからのお客様の対応、体力的にも精神的にも消耗しやすいですよね。最近は退勤後すぐに軽いストレッチをするようにしてから、翌日の疲労感がだいぶ軽くなりました。良かったら試してみてください。',
    tags: ['日記', 'ライフスタイル'],
    likeCount: 55,
    commentCount: 9,
  },
  {
    id: 'p5',
    authorName: 'ゆる活キャスト',
    authorInitial: 'ゆ',
    authorColor: 'var(--noxa-status-success)',
    postedAt: '8時間前',
    body: '先月から週 4 勤務に落として、空き日はほぼ完全にオフにしています。以前は週 6 で頑張っていたのですが、逆に月の指名数が増えました。余裕を持つことが結果につながるのかもしれません。',
    tags: ['日記', '働き方'],
    likeCount: 88,
    commentCount: 21,
  },
  {
    id: 'p6',
    authorName: '無口な観察者',
    authorInitial: '観',
    authorColor: '#C4384A',
    postedAt: '昨日',
    body: '新規のお客様が次回来店されるかどうかを初回の会話だけで読む力、これは経験でしか養えないと痛感しています。一方で、数年やってみてある種のパターンには気づきました。言語化できたらまた共有します。',
    tags: ['同伴', '接客'],
    likeCount: 37,
    commentCount: 6,
  },
];

const POPULAR_TAGS = ['#同伴', '#指名', '#日記', '#接客', '#美容', '#働き方', '#ライフスタイル'];

// ダミー招待コード（表示専用）
const DUMMY_INVITE_CODE = 'NXC-2026-XXXXXX';

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export function CommunityClient() {
  const [draftText, setDraftText] = useState('');

  return (
    <main
      className="noxa-zone"
      style={{
        minHeight: '100dvh',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--noxa-bg-base)',
      }}
    >
      {/* ambient glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          left: '30%',
          width: 700,
          height: 500,
          background: 'radial-gradient(ellipse, rgba(196, 56, 74, 0.13) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          right: '-5%',
          width: 400,
          height: 400,
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.10) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto' }}>

        {/* ─ breadcrumb ─ */}
        <nav aria-label="パンくず" style={{ marginBottom: 16 }}>
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
                Noxa
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li>community</li>
          </ol>
        </nav>

        {/* ─ ヘッダ ─ */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 28,
            paddingBottom: 20,
            borderBottom: '1px solid var(--noxa-divider)',
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>
              Noxa · SUB MODULE A · CLOSED SNS
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              {/* Noxa ロゴ */}
              <span className="noxa-logo" style={{ fontSize: 22 }} aria-label="Noxa">
                N<em>o</em>xa
              </span>
              <h1
                style={{
                  fontFamily: fontDisplay,
                  fontSize: 'clamp(22px, 4vw, 32px)',
                  fontWeight: 500,
                  margin: 0,
                  color: 'var(--noxa-text-primary)',
                  letterSpacing: '0.02em',
                }}
              >
                Community
              </h1>
            </div>
          </div>

          {/* 紹介制バッジ */}
          <div
            role="note"
            aria-label="このコミュニティは紹介制で近日公開予定です"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: 'rgba(168, 159, 190, 0.10)',
              border: '1px solid var(--noxa-divider)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--noxa-status-soon)',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-status-soon)',
                flexShrink: 0,
              }}
            />
            招待制 · Coming Soon
          </div>
        </header>

        {/* ─ 本文レイアウト ─ */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]" style={{ gap: 'clamp(16px, 2vw, 24px)', alignItems: 'start' }}>

          {/* ─ メイン列 ─ */}
          <div>

            {/* 投稿作成ボックス */}
            <section
              aria-label="投稿作成"
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
                marginBottom: 20,
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              {/* 自分のアバター */}
              <Avatar initial="あ" color="var(--noxa-accent-primary)" size={40} />

              <div style={{ flex: 1 }}>
                <textarea
                  placeholder="いまどんな話をシェアしますか。このコミュニティは匿名ニックネームで参加できます。"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={3}
                  aria-label="投稿内容を入力"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    resize: 'none',
                    background: 'var(--noxa-bg-elevated)',
                    border: '1px solid var(--noxa-border)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: 'var(--noxa-text-primary)',
                    fontFamily: fontJp,
                    fontSize: 16,          /* iOS auto-zoom 回避のため 16px */
                    lineHeight: 1.6,
                    outline: 'none',
                    transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    marginBottom: 10,
                    display: 'block',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--noxa-accent-primary)';
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(139, 92, 246, 0.18)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--noxa-border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    disabled={draftText.trim().length === 0}
                    onClick={() => {
                      /* ガワのみ — 実装時に投稿 API 呼び出し */
                    }}
                    aria-label="投稿する"
                    style={{
                      appearance: 'none',
                      cursor: draftText.trim().length === 0 ? 'not-allowed' : 'pointer',
                      minHeight: 44,
                      padding: '10px 20px',
                      borderRadius: 10,
                      border: '1px solid var(--noxa-accent-primary)',
                      background: draftText.trim().length === 0
                        ? 'var(--noxa-surface-hover)'
                        : 'var(--noxa-accent-primary)',
                      color: draftText.trim().length === 0
                        ? 'var(--noxa-text-faint)'
                        : '#fff',
                      fontFamily: fontJp,
                      fontSize: 14,
                      fontWeight: 600,
                      transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    }}
                  >
                    投稿する
                  </button>
                </div>
              </div>
            </section>

            {/* タイムライン */}
            <section aria-label="タイムライン">
              <SectionLabel>タイムライン</SectionLabel>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {MOCK_POSTS.map((post) => (
                  <li key={post.id}>
                    <PostCard post={post} />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* ─ サイドバー（lg のみ） ─ */}
          <aside aria-label="サイドバー" className="hidden lg:flex" style={{ flexDirection: 'column', gap: 16 }}>

            {/* 人気タグ */}
            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
              }}
            >
              <SectionLabel>人気タグ</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {POPULAR_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      /* ガワのみ */
                    }}
                    aria-label={`${tag} タグで絞り込む`}
                    style={{
                      appearance: 'none',
                      cursor: 'pointer',
                      padding: '5px 12px',
                      minHeight: 32,
                      borderRadius: 9999,
                      background: 'var(--noxa-surface-muted)',
                      border: '1px solid var(--noxa-border)',
                      color: 'var(--noxa-text-muted)',
                      fontFamily: mono,
                      fontSize: 12,
                      letterSpacing: '0.04em',
                      transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* 招待制について */}
            <div
              style={{
                background: 'linear-gradient(135deg, #1A1228 0%, #221830 100%)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 18,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  right: -60,
                  top: -60,
                  width: 180,
                  height: 180,
                  background: 'radial-gradient(circle, rgba(196, 56, 74, 0.18) 0%, transparent 60%)',
                  pointerEvents: 'none',
                }}
              />
              <div style={{ position: 'relative' }}>
                <SectionLabel>招待制について</SectionLabel>
                <p
                  style={{
                    color: 'var(--noxa-text-muted)',
                    fontSize: 13,
                    lineHeight: 1.75,
                    fontFamily: fontJp,
                    margin: '0 0 14px',
                  }}
                >
                  本コミュニティは既存メンバーからの招待を受けた方のみ参加できます。安心して話せる場を守るため、匿名ニックネームを採用しています。
                </p>
                <div
                  style={{
                    borderTop: '1px solid var(--noxa-divider)',
                    paddingTop: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: mono,
                      color: 'var(--noxa-text-faint)',
                      letterSpacing: '0.08em',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                    }}
                  >
                    招待コード（表示専用・ダミー）
                  </div>
                  <div
                    role="textbox"
                    aria-readonly="true"
                    aria-label="ダミー招待コード"
                    style={{
                      fontFamily: mono,
                      fontSize: 14,
                      letterSpacing: '0.18em',
                      color: 'var(--noxa-accent-primary-ink)',
                      background: 'var(--noxa-surface-muted)',
                      border: '1px solid var(--noxa-border)',
                      borderRadius: 8,
                      padding: '9px 12px',
                      userSelect: 'text',
                    }}
                  >
                    {DUMMY_INVITE_CODE}
                  </div>
                  <p
                    style={{
                      margin: '8px 0 0',
                      fontSize: 11,
                      color: 'var(--noxa-text-faint)',
                      fontFamily: mono,
                    }}
                  >
                    ※ 実際のコードは近日公開予定
                  </p>
                </div>
              </div>
            </div>
          </aside>

        </div>{/* /grid */}
      </div>

      {/* ─ Coming Soon オーバーレイ（半透明バナー） ─ */}
      <div
        role="banner"
        aria-label="このページは近日公開予定です"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '14px clamp(16px, 3vw, 28px)',
          background: 'rgba(7, 5, 13, 0.82)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--noxa-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="noxa-status noxa-status-soon"
            aria-hidden
            style={{ fontSize: 11, letterSpacing: '0.14em' }}
          >
            COMING SOON
          </span>
          <span
            style={{
              fontFamily: fontJp,
              fontSize: 13,
              color: 'var(--noxa-text-muted)',
            }}
          >
            招待制コミュニティは現在準備中です。Noxa アカウント作成で開始通知をお届けします。
          </span>
        </div>
        <Link
          href="/account/signup"
          style={{
            appearance: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            padding: '10px 20px',
            borderRadius: 10,
            border: '1px solid var(--noxa-accent-primary)',
            background: 'var(--noxa-accent-primary)',
            color: '#fff',
            fontFamily: fontJp,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
            flexShrink: 0,
          }}
        >
          通知を受け取る
        </Link>
      </div>

    </main>
  );
}

// ─────────────────────────────────────────────
// 投稿カード
// ─────────────────────────────────────────────

function PostCard({ post }: { post: MockPost }) {
  return (
    <article
      aria-label={`${post.authorName} の投稿`}
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 16,
        padding: 18,
        transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}
    >
      {/* 投稿者行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <Avatar initial={post.authorInitial} color={post.authorColor} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: fontJp,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--noxa-text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {post.authorName}
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: 'var(--noxa-text-faint)',
              letterSpacing: '0.04em',
              marginTop: 1,
            }}
          >
            {post.postedAt}
          </div>
        </div>
      </div>

      {/* 本文 */}
      <p
        style={{
          fontFamily: fontJp,
          fontSize: 14,
          lineHeight: 1.75,
          color: 'var(--noxa-text-primary)',
          margin: '0 0 12px',
        }}
      >
        {post.body}
      </p>

      {/* タグ */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {post.tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-accent-primary-ink)',
              background: 'rgba(139, 92, 246, 0.12)',
              border: '1px solid rgba(184, 156, 251, 0.25)',
              borderRadius: 9999,
              padding: '3px 9px',
            }}
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* 区切り線 */}
      <div
        style={{
          height: 1,
          background: 'var(--noxa-divider)',
          marginBottom: 10,
        }}
        aria-hidden
      />

      {/* リアクション行 */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <ReactionButton
          label="いいね"
          icon="♥"
          count={post.likeCount}
          onClick={() => { /* ガワのみ */ }}
        />
        <ReactionButton
          label="コメント"
          icon="◎"
          count={post.commentCount}
          onClick={() => { /* ガワのみ */ }}
        />
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────
// リアクションボタン
// ─────────────────────────────────────────────

function ReactionButton({
  label,
  icon,
  count,
  onClick,
}: {
  label: string;
  icon: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} ${count}件`}
      style={{
        appearance: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        padding: '6px 8px',
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        color: 'var(--noxa-text-faint)',
        transition: 'color var(--noxa-duration-fast) var(--noxa-ease-natural)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--noxa-accent-primary-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--noxa-text-faint)';
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 15,
          lineHeight: 1,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
        }}
      >
        {count}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────
// 汎用ヘルパーコンポーネント
// ─────────────────────────────────────────────

function Avatar({
  initial,
  color,
  size,
}: {
  initial: string;
  color: string;
  size: number;
}) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: mono,
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        color: '#fff',
        flexShrink: 0,
        opacity: 0.85,
      }}
    >
      {initial}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="noxa-eyebrow"
      style={{ fontSize: 11, marginBottom: 12, display: 'block' }}
    >
      {children}
    </h2>
  );
}

export default CommunityClient;
