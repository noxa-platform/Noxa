'use client';

/**
 * コミュニティ管理（admin 専用）。
 *  - 通報一覧（対象ごと・通報者数つき）→ 非表示/復帰/解決
 *  - 会員の招待発行権 停止/復帰（uid 指定）
 * すべて /api/community/admin/* （Admin SDK・admin 検証）経由。
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { FONT, WINE } from '@/lib/community/constants';
import { auth } from '@/lib/firebase/config';

const { mono, jp: fontJp, display: fontDisplay } = FONT;

interface ReportItem {
  targetType: 'thread' | 'reply';
  targetId: string;
  postId: string;
  preview: string;
  exists: boolean;
  /** 対象の取得自体に失敗した（true のとき exists:false は「削除済み」ではない・Day116） */
  fetchFailed?: boolean;
  hidden: boolean;
  reportCount: number;
  reporters: number;
  reportIds: string[];
  open: boolean;
}

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error('ログインが必要です');
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || '通信に失敗しました');
  return data as T;
}

export function CommunityAdminClient({ user }: { user: User }) {
  void user;
  // 一覧未取得（null）を loading として導出（load 冒頭の同期 setLoading は set-state-in-effect 違反）
  const [itemsSnap, setItemsSnap] = useState<ReportItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [revokeUid, setRevokeUid] = useState('');
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);
  const items = itemsSnap ?? [];
  const loading = itemsSnap === null && !err;

  const load = useCallback(async () => {
    try { const r = await adminPost<{ items: ReportItem[] }>('/api/community/admin/reports', {}); setItemsSnap(r.items); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : '取得に失敗しました'); setItemsSnap([]); }
  }, []);

  // 初回は then 形式（effect から async 関数を直接呼ぶと同期区間の setState と見なされる）
  useEffect(() => {
    let alive = true;
    adminPost<{ items: ReportItem[] }>('/api/community/admin/reports', {})
      .then((r) => { if (alive) { setItemsSnap(r.items); setErr(null); } })
      .catch((e) => { if (alive) { setErr(e instanceof Error ? e.message : '取得に失敗しました'); setItemsSnap([]); } });
    return () => { alive = false; };
  }, []);

  const act = async (it: ReportItem, action: 'hide' | 'unhide' | 'resolve') => {
    const key = `${it.targetType}:${it.targetId}`;
    setBusyKey(key);
    try {
      await adminPost('/api/community/admin/action', { action, targetType: it.targetType, targetId: it.targetId, reportIds: it.reportIds });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : '操作に失敗しました'); }
    finally { setBusyKey(null); }
  };

  const revoke = async (action: 'revokeInvite' | 'restoreInvite') => {
    const uid = revokeUid.trim();
    if (!uid) return;
    setRevokeMsg(null);
    try {
      await adminPost('/api/community/admin/action', { action, uid });
      setRevokeMsg(action === 'revokeInvite' ? `発行権を停止しました（${uid}）` : `発行権を復帰しました（${uid}）`);
    } catch (e) { setRevokeMsg(e instanceof Error ? e.message : '操作に失敗しました'); }
  };

  return (
    <main style={{ minHeight: '100dvh', padding: 'clamp(16px, 3vw, 28px)', background: 'var(--noxa-bg-base)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div className="noxa-eyebrow" style={{ marginBottom: 8 }}>Noxa · Channel · 管理</div>
        <h1 style={{ fontFamily: fontDisplay, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 600, margin: '0 0 20px', color: 'var(--noxa-text-primary)' }}>コミュニティ管理</h1>

        {/* 通報一覧 */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontFamily: fontJp, fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--noxa-text-primary)' }}>通報（未処理）</h2>
            <button type="button" onClick={load} className="noxa-btn noxa-btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>再読込</button>
          </div>
          {err && <p role="alert" style={{ fontFamily: fontJp, fontSize: 13, color: 'var(--noxa-status-error)' }}>{err}</p>}
          {loading ? (
            <p style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</p>
          ) : items.length === 0 ? (
            <p style={{ fontFamily: fontJp, fontSize: 13, color: 'var(--noxa-text-muted)' }}>未処理の通報はありません。</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it) => {
                const key = `${it.targetType}:${it.targetId}`;
                const busy = busyKey === key;
                return (
                  <div key={key} style={{ border: `1px solid ${it.hidden ? WINE : 'var(--noxa-border)'}`, borderRadius: 12, padding: 14, background: 'var(--noxa-surface-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-text-faint)' }}>{it.targetType === 'thread' ? 'スレッド' : 'レス'}</span>
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--noxa-accent-primary-ink)' }}>通報 {it.reporters}人</span>
                      {it.hidden && <span style={{ fontFamily: mono, fontSize: 10, color: '#fff', background: WINE, borderRadius: 6, padding: '1px 7px' }}>非表示中</span>}
                      {!it.exists && (it.fetchFailed
                        ? <span role="alert" style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-status-error)' }}>取得失敗（削除済みとは限りません）</span>
                        : <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>削除済み</span>)}
                    </div>
                    <p style={{ fontFamily: fontJp, fontSize: 13.5, lineHeight: 1.7, color: 'var(--noxa-text-primary)', margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{it.preview || '(本文なし)'}</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {it.exists && !it.hidden && <button type="button" disabled={busy} onClick={() => act(it, 'hide')} className="noxa-btn noxa-btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}>非表示にする</button>}
                      {it.exists && it.hidden && <button type="button" disabled={busy} onClick={() => act(it, 'unhide')} className="noxa-btn noxa-btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>復帰させる</button>}
                      <button type="button" disabled={busy} onClick={() => act(it, 'resolve')} className="noxa-btn noxa-btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>解決済みにする</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 招待発行権の停止/復帰 */}
        <section>
          <h2 style={{ fontFamily: fontJp, fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--noxa-text-primary)' }}>招待の発行権</h2>
          <p style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)', margin: '0 0 12px' }}>信頼ベースの最終手段。BAN ではなく「招待コードの発行だけ」を停止します（本人の投稿は可）。</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={revokeUid} onChange={(e) => setRevokeUid(e.target.value)} placeholder="対象の uid" className="noxa-input" style={{ fontFamily: mono, fontSize: 12, flex: '1 1 240px' }} />
            <button type="button" onClick={() => revoke('revokeInvite')} className="noxa-btn noxa-btn-primary" style={{ fontSize: 12, padding: '8px 14px' }}>発行権を停止</button>
            <button type="button" onClick={() => revoke('restoreInvite')} className="noxa-btn noxa-btn-secondary" style={{ fontSize: 12, padding: '8px 14px' }}>復帰</button>
          </div>
          {revokeMsg && <p style={{ fontFamily: fontJp, fontSize: 12.5, color: 'var(--noxa-text-muted)', marginTop: 10 }}>{revokeMsg}</p>}
        </section>
      </div>
    </main>
  );
}

export default CommunityAdminClient;
