'use client';

/**
 * 招待制ゲート。ログイン済みでも「コミュニティ会員」でなければ入れない。
 *  - /api/community/me でメンバー判定
 *  - 非会員には招待コード入力画面を出す（?invite=CODE があれば自動入力）
 *  - 引き換え成功で会員化 → 子（CommunityClient）を表示
 */

import { useCallback, useEffect, useState } from 'react';
import { FONT, WINE } from '@/lib/community/constants';
import { fetchCommunityMe, redeemInvite, type CommunityMe } from '@/lib/community/api';

const { mono, jp: fontJp, display: fontDisplay } = FONT;

export function InviteGate({ children }: { children: (me: CommunityMe) => React.ReactNode }) {
  const [me, setMe] = useState<CommunityMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setMe(await fetchCommunityMe()); } catch (e) { setError(e instanceof Error ? e.message : '取得に失敗しました'); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // ?invite=CODE を初期値に
    if (typeof window !== 'undefined') {
      const c = new URLSearchParams(window.location.search).get('invite');
      if (c) setCode(c);
    }
    refresh();
  }, [refresh]);

  const submit = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setError(null);
    try {
      await redeemInvite(c);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '引き換えに失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Centered><span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</span></Centered>;
  }

  if (me?.isMember) return <>{children(me)}</>;

  // 非会員 → 招待コード入力
  return (
    <Centered>
      <div style={{ width: 'min(440px, 92vw)', background: 'var(--noxa-surface-card)', border: `1px solid ${WINE}55`, borderRadius: 18, padding: 'clamp(22px, 5vw, 34px)' }}>
        <div className="noxa-eyebrow" style={{ marginBottom: 10 }}>Noxa · Channel · 招待制</div>
        <h1 style={{ fontFamily: fontDisplay, fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 600, margin: '0 0 10px', color: 'var(--noxa-text-primary)' }}>招待コードが必要です</h1>
        <p style={{ fontFamily: fontJp, fontSize: 13.5, lineHeight: 1.8, color: 'var(--noxa-text-muted)', margin: '0 0 18px' }}>
          NOXA Channel は招待制クローズドの匿名コミュニティです。既存メンバーや運営から受け取った招待コードを入力してください。
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <span className="noxa-label" style={{ margin: 0 }}>招待コード</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="例：a1B2c3D4e5"
            className="noxa-input"
            autoFocus
            style={{ fontFamily: mono }}
          />
        </label>
        {error && <p role="alert" style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-status-error)', margin: '0 0 12px' }}>{error}</p>}
        <button type="button" onClick={submit} disabled={busy || !code.trim()} className="noxa-btn noxa-btn-primary" style={{ width: '100%' }}>
          {busy ? '確認中…' : '参加する'}
        </button>
        <p style={{ fontFamily: fontJp, fontSize: 11, color: 'var(--noxa-text-faint)', margin: '14px 0 0', textAlign: 'center' }}>
          コードは1回のみ・発行から7日で失効します。
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--noxa-bg-base)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-15%', left: '30%', width: 600, height: 420, background: `radial-gradient(ellipse, ${WINE}22 0%, transparent 65%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>{children}</div>
    </main>
  );
}
