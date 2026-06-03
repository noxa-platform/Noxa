'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, Timestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { Shell, Section, Empty, Eyebrow } from '@/components/modules/schedule/ScheduleClient';

/**
 * 通知センター — Noxa OS（実データ）
 * notification_inbox（userId == 自分）を読み、既読化する。
 */
const mono = 'var(--noxa-font-mono)';

type Notif = { id: string; title: string; body: string; at: number | null; read: boolean; kind: string };

function toMs(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  return null;
}
function mapN(id: string, d: DocumentData): Notif {
  return {
    id,
    title: (d.title as string) ?? (d.kind as string) ?? 'お知らせ',
    body: (d.body as string) ?? (d.message as string) ?? '',
    at: toMs(d.createdAt ?? d.sentAt ?? d.at),
    read: d.read === true || d.isRead === true,
    kind: (d.kind as string) ?? (d.type as string) ?? '',
  };
}
const fmt = (ms: number | null) => { if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function NotificationsClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Notif[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'notification_inbox'), where('userId', '==', user.uid)));
        const out: Notif[] = []; snap.forEach((d) => out.push(mapN(d.id, d.data())));
        out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
        if (alive) setList(out);
      } catch { /* skip */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid]);

  const markRead = async (id: string) => {
    setList((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await updateDoc(doc(db, `notification_inbox/${id}`), { read: true }); } catch { /* skip */ }
  };
  const unread = list.filter((n) => !n.read);

  return (
    <Shell title="通知センター" eyebrow="Noxa OS · Notifications" crumb="notifications">
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : list.length === 0 ? (
        <Section label="通知">
          <Empty>通知はまだありません。誕生日リマインド・売上サマリ等がここに届きます。</Empty>
        </Section>
      ) : (
        <Section label={`通知${unread.length > 0 ? `（未読 ${unread.length}）` : ''}`}>
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
