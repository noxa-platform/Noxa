'use client';

/**
 * サブ機能 A — 夜職専用 招待制クローズド匿名コミュニティ（掲示板）
 *
 * 形式: カテゴリ別フォーラム（板一覧 → スレッド一覧 → スレッド詳細）。
 * ポジショニング: 招待制 × 完全匿名 × 健全モデレーション（爆サイ・ホスラブの健全版）。
 *
 * データは lib/community の repository 抽象（現状 Mock）経由。Firestore（noxa_*）への
 * 差し替えは createCommunityRepository を変えるだけで、このオーケストレーターは無改修。
 * 仕様の正本: web-knowledge/20_cases/noxa-app-mvp-and-community-launch-2026-05-22.md
 */

import Link from 'next/link';
import { FONT, WINE } from '@/lib/community/constants';
import { useCommunity } from '@/lib/community/store';
import { BoardList } from './BoardList';
import { ThreadList } from './ThreadList';
import { ThreadDetail } from './ThreadDetail';
import { crumbBtn } from './ui';

const { mono, jp: fontJp, display: fontDisplay } = FONT;

export function CommunityClient({ uid }: { uid?: string } = {}) {
  const c = useCommunity(uid);
  // mock バックエンドのときだけ「保存されません」注記を出す（firestore 本番では実データ保存）
  const isMock = process.env.NEXT_PUBLIC_COMMUNITY_BACKEND !== 'firestore';

  return (
    <main
      className="noxa-zone"
      style={{ minHeight: '100dvh', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden', background: 'var(--noxa-bg-base)' }}
    >
      {/* ambient glow（community = wine 寄り） */}
      <div aria-hidden style={{ position: 'absolute', top: '-20%', left: '25%', width: 700, height: 480, background: `radial-gradient(ellipse, ${WINE}22 0%, transparent 65%)`, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', top: '45%', right: '-5%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', maxWidth: 920, margin: '0 auto', paddingBottom: 96 }}>

        {/* ─ breadcrumb ─ */}
        <nav aria-label="パンくず" style={{ marginBottom: 16 }}>
          <ol style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
            <li><Link href="/" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa</Link></li>
            <li aria-hidden>·</li>
            <li><button type="button" onClick={c.backToBoards} style={crumbBtn(c.view === 'boards')}>channel</button></li>
            {c.board && c.view !== 'boards' && (
              <>
                <li aria-hidden>·</li>
                <li><button type="button" onClick={c.backToThreads} style={crumbBtn(c.view === 'threads')}>{c.board.name}</button></li>
              </>
            )}
            {c.view === 'thread' && c.thread && (
              <>
                <li aria-hidden>·</li>
                <li style={{ color: 'var(--noxa-text-faint)' }}>スレッド</li>
              </>
            )}
          </ol>
        </nav>

        {/* ─ ヘッダ ─ */}
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24, paddingBottom: 18, borderBottom: '1px solid var(--noxa-divider)' }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Noxa · Channel · 招待制クローズド掲示板</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span className="noxa-logo" style={{ fontSize: 22 }} aria-label="Noxa">N<em>o</em>xa</span>
              <h1 style={{ fontFamily: fontDisplay, fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 500, margin: 0, color: 'var(--noxa-text-primary)', letterSpacing: '0.02em' }}>Channel</h1>
            </div>
          </div>
          <div role="note" aria-label="招待制・完全匿名" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: `${WINE}1A`, border: `1px solid ${WINE}55`, borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: '#E89AA6', textTransform: 'uppercase', flexShrink: 0 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: WINE, flexShrink: 0 }} />
            招待制 · 完全匿名
          </div>
        </header>

        {/* ─ ビュー切替 ─ */}
        {c.view === 'boards' && <BoardList boards={c.boards} onOpen={c.openBoard} />}

        {c.view === 'threads' && c.board && (
          <ThreadList
            board={c.board}
            threads={c.threads}
            areaFilter={c.areaFilter}
            jobFilter={c.jobFilter}
            onAreaFilter={c.setAreaFilter}
            onJobFilter={c.setJobFilter}
            onOpenThread={c.openThread}
            onCreate={(title, body, area, job) => c.createThread({ title, body, areaTag: area, jobTag: job })}
          />
        )}

        {c.view === 'thread' && c.thread && (
          <ThreadDetail
            thread={c.thread}
            board={c.board}
            likedIds={c.likedIds}
            likeKey={c.likeKey}
            onToggleLike={c.toggleLike}
            onReport={c.report}
            onReply={(body, area, job) => { if (c.thread) c.addReply(c.thread.id, { body, areaTag: area, jobTag: job }); }}
            onBack={c.backToThreads}
          />
        )}
      </div>

      {/* ─ モック注記バナー（mock バックエンド時のみ） ─ */}
      {isMock && (
        <div role="note" aria-label="これは動作確認用のモックです" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px clamp(16px, 3vw, 28px)', background: 'rgba(7,5,13,0.84)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid var(--noxa-divider)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 40 }}>
          <span className="noxa-status noxa-status-soon" aria-hidden style={{ fontSize: 11, letterSpacing: '0.14em' }}>PROTOTYPE</span>
          <span style={{ fontFamily: fontJp, fontSize: 13, color: 'var(--noxa-text-muted)' }}>掲示板型モック（データはモック層）。投稿・いいね・通報は画面内だけで動き、保存されません（リロードで初期化）。</span>
        </div>
      )}
    </main>
  );
}

export default CommunityClient;
