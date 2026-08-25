'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, type DocumentData } from 'firebase/firestore';
import { describeFirestoreError } from '@/lib/firestore-error';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { Shell, Section, Empty, Eyebrow } from '@/components/modules/schedule/ScheduleClient';
import { toMillis } from '@/lib/datetime';

/**
 * 通知センター — Noxa OS（実データ）
 * notification_inbox（userId == 自分）を読み、既読化する。
 */
const mono = 'var(--noxa-font-mono)';

type Notif = { id: string; title: string; body: string; at: number | null; read: boolean; kind: string };

function mapN(id: string, d: DocumentData): Notif {
  return {
    id,
    title: (d.title as string) ?? (d.kind as string) ?? 'お知らせ',
    body: (d.body as string) ?? (d.message as string) ?? '',
    at: toMillis(d.createdAt ?? d.sentAt ?? d.at),
    read: d.read === true || d.isRead === true,
    kind: (d.kind as string) ?? (d.type as string) ?? '',
  };
}
const fmt = (ms: number | null) => { if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function NotificationsClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Notif[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'notification_inbox'), where('userId', '==', user.uid)));
        const out: Notif[] = []; snap.forEach((d) => out.push(mapN(d.id, d.data())));
        out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
        if (alive) setList(out);
      } catch (e) {
        // 取得失敗を「通知はまだありません」と誤誘導しない（権限/オフライン等）
        // 原因を「通信」と断定していた（権限・認証切れでも同じ文言）。理由をそのまま出す（Day125）
        if (alive) setError(describeFirestoreError(e, '通知の取得'));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid]);

  // 既読は楽観更新。失敗したらその1件だけ未読へ戻す（旧実装は握り潰しで、
  // 画面は既読・サーバは未読のまま＝再読込で戻る理由が分からなかった）
  const markRead = async (id: string) => {
    setList((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setOpError(null);
    try {
      await updateDoc(doc(db, `notification_inbox/${id}`), { read: true });
    } catch (e) {
      setList((p) => p.map((n) => (n.id === id ? { ...n, read: false } : n)));
      setOpError(describeFirestoreError(e, '既読の記録'));
    }
  };
  const unread = list.filter((n) => !n.read);

  // 全件既読（1件ずつタップの手間を省く。楽観更新・失敗分は次回ロードで未読に戻る）
  const [markingAll, setMarkingAll] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const markAllRead = async () => {
    const targets = unread;
    if (targets.length === 0 || markingAll) return;
    setMarkingAll(true);
    setOpError(null);
    setList((p) => p.map((n) => ({ ...n, read: true })));
    try {
      // 失敗した分は未読へ戻し、何件残ったかを伝える（全部黙って戻るのを防ぐ）
      const results = await Promise.all(targets.map(async (n) => {
        try { await updateDoc(doc(db, `notification_inbox/${n.id}`), { read: true }); return null; }
        catch (e) { return { id: n.id, e }; }
      }));
      const failed = results.filter((r): r is { id: string; e: unknown } => r !== null);
      if (failed.length > 0) {
        const ids = new Set(failed.map((f) => f.id));
        setList((p) => p.map((n) => (ids.has(n.id) ? { ...n, read: false } : n)));
        setOpError(`${describeFirestoreError(failed[0].e, '既読の記録')}（${failed.length}件は未読のままです）`);
      }
    } finally { setMarkingAll(false); }
  };

  return (
    <Shell title="通知センター" eyebrow="ノクサ · おしらせ" crumb="notifications">
      {opError && (
        <p role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, fontSize: 13, color: 'var(--noxa-status-error)', background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{opError}</p>
      )}
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : error ? (
        <Section label="通知">
          <Empty>{error}</Empty>
        </Section>
      ) : list.length === 0 ? (
        <Section label="通知">
          <Empty>通知はまだありません。運営からのお知らせや重要な更新がここに届きます。</Empty>
        </Section>
      ) : (
        <Section label={`通知${unread.length > 0 ? `（未読 ${unread.length}）` : ''}`}>
          {unread.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button type="button" onClick={markAllRead}
                style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--noxa-border)', background: 'transparent', color: 'var(--noxa-text-muted)', fontFamily: mono, fontSize: 11, cursor: 'pointer' }}>
                すべて既読にする
              </button>
            </div>
          )}
          {list.map((n) => (
            <div key={n.id} onClick={() => !n.read && markRead(n.id)} style={{ display: 'flex', gap: 10, padding: '12px 12px', borderRadius: 10, background: n.read ? 'var(--noxa-bg-base)' : 'rgba(139,92,246,0.08)', border: `1px solid ${n.read ? 'var(--noxa-border)' : 'var(--noxa-border-strong)'}`, cursor: n.read ? 'default' : 'pointer' }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, flex: 'none', background: n.read ? 'var(--noxa-text-faint)' : 'var(--noxa-accent-primary-ink)', boxShadow: n.read ? 'none' : '0 0 8px var(--noxa-accent-primary-ink)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13, fontWeight: n.read ? 400 : 600 }}>{n.title}</span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{fmt(n.at)}</span>
                </div>
                {n.body && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--noxa-text-muted)', lineHeight: 1.5 }}>{n.body}</p>}
              </div>
            </div>
          ))}
        </Section>
      )}
    </Shell>
  );
}

export default NotificationsClient;
