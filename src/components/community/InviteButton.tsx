'use client';

/**
 * 会員が招待リンクを発行するボタン＋モーダル。
 *  - admin は無制限、会員は残クレジット内で発行（1発行で1消費）
 *  - 発行後はワンタイムリンク（/community?invite=CODE）を表示してコピー
 */

import { useState } from 'react';
import { FONT, WINE } from '@/lib/community/constants';
import { issueInvite } from '@/lib/community/api';

const { mono, jp: fontJp } = FONT;

export function InviteButton({ initialCredits, isAdmin }: { initialCredits: number | null; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(initialCredits);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canIssue = isAdmin || (credits ?? 0) > 0;

  const issue = async () => {
    if (busy || !canIssue) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await issueInvite();
      const url = `${window.location.origin}/community?invite=${r.code}`;
      setLink(url);
      setCredits(r.inviteCredits);
    } catch (e) {
      setError(e instanceof Error ? e.message : '発行に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* 手動コピーに任せる */ }
  };

  const close = () => { setOpen(false); setLink(null); setError(null); setCopied(false); };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="noxa-btn noxa-btn-secondary"
        style={{ fontSize: 12, padding: '8px 14px' }}
      >
        ＋ 招待する{!isAdmin && credits !== null ? `（残${credits}）` : ''}
      </button>

      {open && (
        <div role="dialog" aria-label="招待リンクを発行" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 94vw)', background: 'var(--noxa-bg-base)', border: `1px solid ${WINE}55`, borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontFamily: fontJp, fontSize: 18, fontWeight: 700, color: 'var(--noxa-text-primary)' }}>招待リンクを発行</h2>
            <p style={{ margin: 0, fontFamily: fontJp, fontSize: 13, lineHeight: 1.7, color: 'var(--noxa-text-muted)' }}>
              ワンタイムのリンクを発行します。1回のみ・7日で失効。X DM や LINE で信頼できる相手にだけ渡してください。
              {!isAdmin && <><br />残り招待枠: <strong style={{ color: 'var(--noxa-text-primary)' }}>{credits ?? 0}</strong></>}
            </p>

            {link ? (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input readOnly value={link} className="noxa-input" style={{ fontFamily: mono, fontSize: 12, flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copy} className="noxa-btn noxa-btn-primary" style={{ width: 96 }}>{copied ? 'コピー済' : 'コピー'}</button>
                </div>
                {(isAdmin || (credits ?? 0) > 0) && (
                  <button type="button" onClick={issue} disabled={busy} className="noxa-btn noxa-btn-secondary">{busy ? '発行中…' : 'もう1枚発行'}</button>
                )}
              </>
            ) : (
              <button type="button" onClick={issue} disabled={busy || !canIssue} className="noxa-btn noxa-btn-primary">
                {busy ? '発行中…' : canIssue ? '招待リンクを発行' : '招待枠がありません'}
              </button>
            )}

            {error && <p role="alert" style={{ margin: 0, fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-status-error)' }}>{error}</p>}
            <button type="button" onClick={close} className="noxa-btn noxa-btn-secondary" style={{ alignSelf: 'flex-end', width: 90 }}>閉じる</button>
          </div>
        </div>
      )}
    </>
  );
}
