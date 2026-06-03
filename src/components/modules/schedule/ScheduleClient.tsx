'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';

/**
 * スケジュール — Noxa OS 個人機能（実データ）
 * personal_reminders/{uid}/items に出勤/イベント/MTG 等を保存（本人のみ）。
 */
const mono = 'var(--noxa-font-mono)';
const KINDS = ['出勤', 'イベント', 'MTG', 'アフター', 'その他'];
const KIND_COLOR: Record<string, string> = { 出勤: 'var(--noxa-accent-primary)', イベント: 'var(--noxa-accent-primary-ink)', MTG: '#67E8F9', アフター: '#F5D472', その他: 'var(--noxa-text-faint)' };

type Item = { id: string; title: string; date: string; kind: string; note?: string };

function mapItem(id: string, d: DocumentData): Item {
  return { id, title: (d.title as string) ?? '（無題）', date: (d.date as string) ?? '', kind: (d.kind as string) ?? 'その他', note: (d.note as string) ?? '' };
}

export function ScheduleClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState(KINDS[0]);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const snap = await getDocs(collection(db, `personal_reminders/${user.uid}/items`));
      const list: Item[] = []; snap.forEach((d) => list.push(mapItem(d.id, d.data())));
      setItems(list);
    } catch { /* skip */ }
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [user.uid]);

  const sorted = useMemo(() => [...items].sort((a, b) => a.date.localeCompare(b.date)), [items]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sorted.filter((i) => i.date >= today);
  const past = sorted.filter((i) => i.date < today).reverse();

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await addDoc(collection(db, `personal_reminders/${user.uid}/items`), { title: title.trim(), date, kind, createdAt: serverTimestamp() });
      setTitle(''); await reload();
    } finally { setBusy(false); }
  };
  const remove = async (id: string) => { await deleteDoc(doc(db, `personal_reminders/${user.uid}/items/${id}`)); setItems((p) => p.filter((x) => x.id !== id)); };

  return (
    <Shell title="スケジュール" eyebrow="Noxa OS · Schedule" crumb="schedule">
      <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 180px' }}>
          <span style={lbl}>予定</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：同伴 / 出勤 / イベント名" style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>日付</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, fontFamily: mono }} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>種別</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{KINDS.map((k) => <button key={k} type="button" onClick={() => setKind(k)} style={chip(kind === k)}>{k}</button>)}</div>
        </div>
        <button type="button" onClick={add} disabled={busy || !title.trim()} style={{ ...chip(true), minHeight: 40, padding: '0 18px', opacity: busy || !title.trim() ? 0.6 : 1 }}>追加</button>
      </div>

      {loading ? <Eyebrow>読み込み中…</Eyebrow> : (
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 16 }}>
          <Section label="今後の予定">
            {upcoming.length === 0 ? <Empty>予定はありません。</Empty> : upcoming.map((i) => <Row key={i.id} item={i} onRemove={() => remove(i.id)} />)}
          </Section>
          <Section label="過去">
            {past.length === 0 ? <Empty>履歴はありません。</Empty> : past.slice(0, 20).map((i) => <Row key={i.id} item={i} onRemove={() => remove(i.id)} dim />)}
          </Section>
        </div>
      )}
    </Shell>
  );
}

function Row({ item, onRemove, dim }: { item: Item; onRemove: () => void; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: dim ? 0.6 : 1 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[item.kind] ?? 'var(--noxa-text-faint)', flex: 'none' }} />
      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', minWidth: 78 }}>{item.date}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{item.title}</span>
      <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)' }}>{item.kind}</span>
      <button type="button" onClick={onRemove} title="削除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14 }}>×</button>
    </div>
  );
}

// ── 共通シェル（他モジュールでも流用） ──
export function Shell({ children, title, eyebrow, crumb, badge = '実データ' }: { children: React.ReactNode; title: string; eyebrow: string; crumb: string; badge?: string }) {
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.10) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li><li>{crumb}</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>{title}</h1>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)' }} />{badge}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16 }}>
      <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12 }}>{label}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}
export function Empty({ children }: { children: React.ReactNode }) { return <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)', margin: 0 }}>{children}</p>; }
export function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>{children}</div>; }

export const lbl: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' };
export const field: React.CSSProperties = { width: '100%', minHeight: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 };
export function chip(active: boolean): React.CSSProperties {
  return { appearance: 'none', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 34, padding: '6px 14px', borderRadius: 9999, fontSize: 13, fontWeight: active ? 600 : 400, background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: active ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` };
}

export default ScheduleClient;
