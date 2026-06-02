'use client';

/**
 * 板一覧。出稼ぎ（featured）を wine の一等地で強調、活性度（人がいる感）を表示。
 */

import { FONT, WINE, WINE_INK } from '@/lib/community/constants';
import type { Board } from '@/lib/community/types';
import { SectionLabel } from './ui';

const { mono, jp: fontJp } = FONT;

export function BoardList({ boards, onOpen }: { boards: Board[]; onOpen: (id: string) => void }) {
  return (
    <section aria-label="板一覧">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <SectionLabel>板を選ぶ</SectionLabel>
        <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', letterSpacing: '0.04em' }}>オンライン 312人 · 本日の投稿 196</span>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {boards.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onOpen(b.id)}
              aria-label={`${b.name} を開く`}
              style={{
                appearance: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 14,
                background: b.featured ? `linear-gradient(135deg, ${WINE}1F 0%, var(--noxa-surface-card) 70%)` : 'var(--noxa-surface-card)',
                border: b.featured ? `1px solid ${WINE}66` : '1px solid var(--noxa-border)',
                borderRadius: 14, padding: '16px 18px',
                transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
              }}
            >
              <span aria-hidden style={{ width: 8, alignSelf: 'stretch', borderRadius: 4, background: b.featured ? WINE : 'var(--noxa-accent-primary)', opacity: b.featured ? 0.9 : 0.5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontFamily: fontJp, fontSize: 16, fontWeight: 700, color: 'var(--noxa-text-primary)' }}>{b.name}</span>
                  {b.featured && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', color: WINE_INK, background: `${WINE}22`, border: `1px solid ${WINE}55`, borderRadius: 9999, padding: '2px 8px', textTransform: 'uppercase' }}>ここだけの一次情報</span>}
                </div>
                <p style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)', margin: 0, lineHeight: 1.6 }}>{b.desc}</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, color: 'var(--noxa-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{b.threadCount.toLocaleString()}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>スレッド</div>
                <div style={{ marginTop: 6, fontFamily: mono, fontSize: 10, color: 'var(--noxa-status-success)' }}>本日 +{b.postsToday}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginTop: 2 }}>{b.lastActivity}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 18, background: 'linear-gradient(135deg, #1A1228 0%, #221830 100%)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 16 }}>
        <SectionLabel>この場所について</SectionLabel>
        <p style={{ fontFamily: fontJp, fontSize: 12.5, lineHeight: 1.75, color: 'var(--noxa-text-muted)', margin: 0 }}>
          既存メンバーからの招待を受けた業界の方だけが参加できる、完全匿名の掲示板です。投稿はすべて「名無しさん」で表示され、源氏名・所属店舗・連絡先・画像は投稿できません。安心して本音を置ける場所を、健全なモデレーションで守ります。
        </p>
      </div>
    </section>
  );
}
