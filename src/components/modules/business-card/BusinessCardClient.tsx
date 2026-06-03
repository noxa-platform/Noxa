'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { Shell, Section, Empty, Eyebrow, lbl, field, chip } from '@/components/modules/schedule/ScheduleClient';

/**
 * 名刺発注 — Noxa OS（個人・実データ）
 * personal_business_cards/{uid}/items にキャスト本人の発注を記録。
 */
const mono = 'var(--noxa-font-mono)';
const DESIGNS = ['スタンダード', 'オリシャン', '箔押し', '二つ折り'];

export function BusinessCardClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<{ id: string; data: DocumentData }[]>([]);
  const [design, setDesign] = useState(DESIGNS[0]);
  const [qty, setQty] = useState('100');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const col = `personal_business_cards/${user.uid}/items`;
  const reload = async () => {
    try { const s = await getDocs(collection(db, col)); const o: { id: string; data: DocumentData }[] = []; s.forEach((d) => o.push({ id: d.id, data: d.data() })); o.sort((a, b) => (b.data.createdAt?.seconds ?? 0) - (a.data.createdAt?.seconds ?? 0)); setRows(o); } catch { /* skip */ }
  };
  useEffect(() => { let a = true; (async () => { await reload(); if (a) setLoading(false); })(); return () => { a = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user.uid]);

  const add = async () => {
    if (busy) return; setBusy(true);
    try { await addDoc(collection(db, col), { design, qty: Number(qty) || 0, note, status: '依頼', createdAt: serverTimestamp() }); setNote(''); await reload(); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { await deleteDoc(doc(db, `${col}/${id}`)); setRows((p) => p.filter((r) => r.id !== id)); };

  return (
    <Shell title="名刺発注" eyebrow="Noxa OS · Business Card" crumb="business-card" badge="実データ">
      <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>デザイン</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{DESIGNS.map((d) => <button key={d} type="button" onClick={() => setDesign(d)} style={chip(design === d)}>{d}</button>)}</div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 110 }}><span style={lbl}>枚数</span><input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} style={field} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 160px' }}><span style={lbl}>備考</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="表記名・連絡先など" style={field} /></label>
        <button type="button" onClick={add} disabled={busy} style={{ ...chip(true), minHeight: 40, padding: '0 18px', opacity: busy ? 0.6 : 1 }}>発注</button>
      </div>
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : (
        <Section label={`発注履歴（${rows.length}）`}>
          {rows.length === 0 ? <Empty>名刺の発注履歴はありません。デザインと枚数を選んで発注してください。</Empty> : rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{r.data.design} <span style={{ color: 'var(--noxa-text-muted)', fontWeight: 400, fontFamily: mono }}>×{r.data.qty}</span></span>
              {r.data.note ? <span style={{ fontSize: 11, color: 'var(--noxa-text-muted)' }}>{r.data.note}</span> : null}
              <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)' }}>{r.data.status ?? ''}</span>
              <button type="button" onClick={() => remove(r.id)} title="削除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 14 }}>×</button>
            </div>
          ))}
        </Section>
      )}
    </Shell>
  );
}

export default BusinessCardClient;
