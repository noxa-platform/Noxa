'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, where, serverTimestamp, setDoc, updateDoc, Timestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { Shell, Section, Empty, Eyebrow, chip } from '@/components/modules/schedule/ScheduleClient';

/**
 * 勤怠 — Noxa OS（実データ）
 * shop_shops/{shopId}/shifts に出勤/退勤を記録（本人＝castUid）。
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
      const snap = await getDocs(query(collection(db, `shop_shops/${sid}/shifts`), where('castUid', '==', user.uid)));
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
        if (!sid) {
          const o = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
          const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
          sid = pickShopId(o.docs.map((d) => d.id), ms.docs.map((d) => d.id), getActiveShop()).shopId;
        }
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
    try { await addDoc(collection(db, `shop_shops/${shopId}/shifts`), { castUid: user.uid, date: today, startAt: serverTimestamp(), createdAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };
  const clockOut = async () => {
    if (!shopId || !open || busy) return; setBusy(true);
    try { await updateDoc(doc(db, `shop_shops/${shopId}/shifts/${open.id}`), { endAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="勤怠" eyebrow="ノクサ · 勤怠" crumb="attendance" badge={device.isDevice ? '店舗端末 · 実データ' : '実データ'}>
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

          <ShiftCalendar shopId={shopId} uid={user.uid} shifts={shifts} />

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

// ─────────────────────────────────────────────
// シフトカレンダー（出勤予定）
// 実績(shifts)とは別に shift_plans に保存。本人が月カレンダーで出勤予定を登録、実績時間も重ねて表示。
// ─────────────────────────────────────────────

type Plan = { date: string; start: string; end: string; off: boolean };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function ShiftCalendar({ shopId, uid, shifts }: { shopId: string; uid: string; shifts: Shift[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [editor, setEditor] = useState<{ date: string; start: string; end: string; off: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadPlans = async () => {
    try {
      const snap = await getDocs(query(collection(db, `shop_shops/${shopId}/shift_plans`), where('castUid', '==', uid)));
      const m: Record<string, Plan> = {};
      snap.forEach((d) => { const v = d.data() as DocumentData; if (v.date) m[v.date as string] = { date: v.date as string, start: (v.start as string) ?? '', end: (v.end as string) ?? '', off: v.off === true }; });
      setPlans(m);
    } catch { /* skip */ }
  };
  useEffect(() => { void reloadPlans(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shopId, uid]);

  // 実績の日別合計（分）
  const actualMin = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of shifts) { if (s.date && s.startMs && s.endMs) m[s.date] = (m[s.date] ?? 0) + Math.floor((s.endMs - s.startMs) / 60000); }
    return m;
  }, [shifts]);

  const first = new Date(cursor.y, cursor.m, 1);
  const startWd = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStr = dateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const shiftCount = Object.values(plans).filter((p) => !p.off && (p.start || p.end)).length;

  const move = (dir: -1 | 1) => setCursor((c) => { const d = new Date(c.y, c.m + dir, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const save = async () => {
    if (!editor || busy) return; setBusy(true);
    try {
      await setDoc(doc(db, `shop_shops/${shopId}/shift_plans/${uid}_${editor.date}`), { castUid: uid, date: editor.date, start: editor.start, end: editor.end, off: editor.off, updatedAt: serverTimestamp() }, { merge: true });
      await reloadPlans(); setEditor(null);
    } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!editor || busy) return; setBusy(true);
    try { await deleteDoc(doc(db, `shop_shops/${shopId}/shift_plans/${uid}_${editor.date}`)); await reloadPlans(); setEditor(null); }
    finally { setBusy(false); }
  };

  return (
    <Section label={`シフトカレンダー（出勤予定 ${shiftCount}日）`}>
      {/* 月送り */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button type="button" onClick={() => move(-1)} style={navBtn}>‹</button>
        <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 18, fontWeight: 600 }}>{cursor.y}.{pad(cursor.m + 1)}</span>
        <button type="button" onClick={() => move(1)} style={navBtn}>›</button>
      </div>
      {/* 曜日 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
        {WD.map((w, i) => <div key={w} style={{ textAlign: 'center', fontSize: 11, fontFamily: mono, color: i === 0 ? 'var(--noxa-status-error)' : i === 6 ? 'var(--noxa-status-info)' : 'var(--noxa-text-faint)' }}>{w}</div>)}
      </div>
      {/* 日セル */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const ds = dateStr(cursor.y, cursor.m, d);
          const plan = plans[ds];
          const act = actualMin[ds];
          const isToday = ds === todayStr;
          return (
            <button key={ds} type="button" onClick={() => setEditor({ date: ds, start: plan?.start ?? '19:00', end: plan?.end ?? '24:00', off: plan?.off ?? false })}
              style={{ aspectRatio: '1', minHeight: 52, padding: 3, borderRadius: 8, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1, background: isToday ? 'rgba(139,92,246,0.10)' : 'var(--noxa-bg-base)', border: `1px solid ${isToday ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>
              <span style={{ fontSize: 11, fontFamily: mono, color: 'var(--noxa-text-muted)', textAlign: 'left' }}>{d}</span>
              {plan?.off ? <span style={{ fontSize: 10, color: 'var(--noxa-status-error)', fontWeight: 600 }}>休</span>
                : plan && (plan.start || plan.end) ? <span style={{ fontSize: 9, fontFamily: mono, color: 'var(--noxa-accent-primary-ink)', lineHeight: 1.2 }}>{plan.start}<br />{plan.end}</span>
                : <span />}
              {act ? <span style={{ marginTop: 'auto', fontSize: 9, fontFamily: mono, color: 'var(--noxa-status-success)' }}>実{Math.floor(act / 60)}h{pad(act % 60)}</span> : null}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)', lineHeight: 1.6 }}>日付をタップして出勤予定を登録（<span style={{ color: 'var(--noxa-accent-primary-ink)' }}>予定</span>／<span style={{ color: 'var(--noxa-status-error)' }}>休</span>／<span style={{ color: 'var(--noxa-status-success)' }}>実績</span>）。</p>

      {/* 予定エディタ */}
      {editor && (
        <div onClick={() => setEditor(null)} style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--noxa-font-display-jp)', fontSize: 16 }}>{editor.date} の出勤予定</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={editor.off} onChange={(e) => setEditor({ ...editor, off: e.target.checked })} />休み
            </label>
            {!editor.off && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--noxa-text-muted)' }}>出勤
                  <input type="time" value={editor.start} onChange={(e) => setEditor({ ...editor, start: e.target.value })} style={calField} /></label>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--noxa-text-muted)' }}>退勤
                  <input type="time" value={editor.end} onChange={(e) => setEditor({ ...editor, end: e.target.value })} style={calField} /></label>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={save} disabled={busy} style={{ flex: 1, minHeight: 44, borderRadius: 12, cursor: 'pointer', background: 'var(--noxa-accent-primary)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600 }}>保存</button>
              <button type="button" onClick={clear} disabled={busy} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, cursor: 'pointer', background: 'transparent', color: 'var(--noxa-status-error)', border: '1px solid var(--noxa-border)', fontSize: 14 }}>クリア</button>
              <button type="button" onClick={() => setEditor(null)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, cursor: 'pointer', background: 'transparent', color: 'var(--noxa-text-muted)', border: '1px solid var(--noxa-border)', fontSize: 14 }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

const navBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, cursor: 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 18 };
const calField: React.CSSProperties = { minHeight: 40, padding: '6px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 14, fontFamily: mono };

export default AttendanceClient;
