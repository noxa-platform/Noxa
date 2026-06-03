'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, doc, getDocs, query, where, serverTimestamp, updateDoc, Timestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { Shell, Section, Empty, Eyebrow, chip } from '@/components/modules/schedule/ScheduleClient';

/**
 * 勤怠 — Noxa OS（実データ）
 * shop_shops/{shopId}/shifts に出勤/退勤を記録（本人＝castUserId）。
 */
const mono = 'var(--noxa-font-mono)';

type Shift = { id: string; date: string; startMs: number | null; endMs: number | null };
function toMs(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  if (typeof v === 'number') return v;
  return null;
}
function mapShift(id: string, d: DocumentData): Shift {
  return { id, date: (d.date as string) ?? '', startMs: toMs(d.startAt), endMs: toMs(d.endAt) };
}
const hhmm = (ms: number | null) => { if (!ms) return '—'; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function dur(a: number | null, b: number | null) { if (!a || !b) return ''; const m = Math.floor((b - a) / 60000); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`; }

export function AttendanceClient({ user }: { user: User }) {
  const device = useDeviceClaims(user);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const reload = async (sid: string) => {
    try {
      const snap = await getDocs(query(collection(db, `shop_shops/${sid}/shifts`), where('castUserId', '==', user.uid)));
      const list: Shift[] = []; snap.forEach((d) => list.push(mapShift(d.id, d.data())));
      list.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
      setShifts(list);
    } catch { /* skip */ }
  };

  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      let sid: string | null = device.isDevice ? device.shopId || null : null;
      try {
        if (!sid) { const o = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid))); if (!o.empty) sid = o.docs[0].id; }
        if (!sid) { const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`)); if (!ms.empty) sid = ms.docs[0].id; }
      } catch { /* skip */ }
      if (!alive) return;
      setShopId(sid);
      if (sid) await reload(sid);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);

  const today = new Date().toISOString().slice(0, 10);
  const open = shifts.find((s) => !s.endMs);
  const todayDone = shifts.filter((s) => s.date === today && s.endMs);

  const clockIn = async () => {
    if (!shopId || busy) return; setBusy(true);
    try { await addDoc(collection(db, `shop_shops/${shopId}/shifts`), { castUserId: user.uid, date: today, startAt: serverTimestamp(), createdAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };
  const clockOut = async () => {
    if (!shopId || !open || busy) return; setBusy(true);
    try { await updateDoc(doc(db, `shop_shops/${shopId}/shifts/${open.id}`), { endAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="勤怠" eyebrow="Noxa OS · Attendance" crumb="attendance" badge={device.isDevice ? '店舗端末 · 実データ' : '実データ'}>
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : !shopId ? (
        <Section label="勤怠"><Empty>所属店舗が見つかりません。</Empty></Section>
      ) : (
        <>
          {/* 打刻 */}
          <section style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 6 }}>今日の勤務</div>
              {open ? (
                <div style={{ fontSize: 15 }}>出勤中 <span style={{ fontFamily: mono, color: 'var(--noxa-accent-primary-ink)' }}>{hhmm(open.startMs)}〜</span> <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-muted)' }}>（{dur(open.startMs, Date.now())}）</span></div>
              ) : <div style={{ fontSize: 14, color: 'var(--noxa-text-muted)' }}>未出勤</div>}
            </div>
            {open
              ? <button type="button" onClick={clockOut} disabled={busy} style={{ ...chip(true), minHeight: 48, padding: '0 28px', background: 'var(--noxa-accent-destructive)', borderColor: 'var(--noxa-accent-destructive)', fontSize: 15 }}>退勤</button>
              : <button type="button" onClick={clockIn} disabled={busy} style={{ ...chip(true), minHeight: 48, padding: '0 28px', fontSize: 15 }}>出勤</button>}
          </section>

          {todayDone.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--noxa-text-muted)', margin: '0 0 16px' }}>本日の完了勤務：{todayDone.map((s) => `${hhmm(s.startMs)}–${hhmm(s.endMs)}`).join(' / ')}</p>
          )}

          <Section label="勤怠履歴">
            {shifts.length === 0 ? <Empty>記録はまだありません。</Empty> : shifts.slice(0, 30).map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)' }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', minWidth: 84 }}>{s.date}</span>
                <span style={{ fontFamily: mono, fontSize: 13, flex: 1 }}>{hhmm(s.startMs)} – {s.endMs ? hhmm(s.endMs) : <span style={{ color: 'var(--noxa-accent-primary-ink)' }}>勤務中</span>}</span>
                <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>{dur(s.startMs, s.endMs)}</span>
              </div>
            ))}
          </Section>
        </>
      )}
    </Shell>
  );
}

export default AttendanceClient;
