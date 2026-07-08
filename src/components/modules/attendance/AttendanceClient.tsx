'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, where, serverTimestamp, setDoc, updateDoc, Timestamp, type DocumentData } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { useShopRole, hasShopRole } from '@/lib/useShopRole';
import { summarizeTeamShifts, type TeamShift } from '@/lib/attendance/summary';
import { Shell, Section, Empty, Eyebrow, chip } from '@/components/modules/schedule/ScheduleClient';

/**
 * shifts.date の日付キー規約: 打刻側（clockIn）が書く `toISOString().slice(0,10)`（UTC 暦日）。
 * チーム集計の「本日」判定はこの規約に合わせる（businessDayKey=JST 6時切替を使うと
 * 朝6〜9時の打刻が本日に出ないズレが出る）。規約自体の変更は既存データ互換に響くため不変。
 */
const shiftDateKey = () => new Date().toISOString().slice(0, 10);

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
  // 横断一覧の表示ゲート（owner/manager。rules 上 shifts は全メンバー read 可＝変更なし）
  const roleCtx = useShopRole(user);
  const canOversee = !device.isDevice && hasShopRole(roleCtx, ['manager']);
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);
  // 30秒ティック。render 中の Date.now() 直呼び（react-hooks/purity）を避けるため now を state で持つ
  const [now, setTick] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 30000); return () => clearInterval(t); }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = async (sid: string) => {
    try {
      const snap = await getDocs(query(collection(db, `shop_shops/${sid}/shifts`), where('castUid', '==', user.uid)));
      const list: Shift[] = []; snap.forEach((d) => list.push(mapShift(d.id, d.data())));
      list.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
      setShifts(list); setLoadError(null);
    } catch (e) {
      // 権限エラー等を握りつぶすと「空画面」に見える → 可視化
      setLoadError(`勤怠の読み込みに失敗しました（${(e as { code?: string; message?: string }).code ?? (e as Error).message}）`);
    }
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
  // 「今日の未退勤」と「過去日の退勤忘れ」を区別する。
  // 旧実装は日付を見ずに最初の未退勤を対象にしていたため、前日の退勤忘れが
  // 今日の出勤をブロックし、退勤すると前日の記録に今日の時刻が入る事故があった。
  const openToday = shifts.find((s) => !s.endMs && s.date === today);
  const staleOpens = shifts.filter((s) => !s.endMs && s.date !== today);
  const todayDone = shifts.filter((s) => s.date === today && s.endMs);

  const clockIn = async () => {
    if (!shopId || busy) return; setBusy(true);
    try { await addDoc(collection(db, `shop_shops/${shopId}/shifts`), { castUid: user.uid, date: today, startAt: serverTimestamp(), createdAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };
  const clockOut = async () => {
    if (!shopId || !openToday || busy) return; setBusy(true);
    try { await updateDoc(doc(db, `shop_shops/${shopId}/shifts/${openToday.id}`), { endAt: serverTimestamp() }); await reload(shopId); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="勤怠" eyebrow="ノクサ · 勤怠" crumb="attendance" badge={device.isDevice ? '店舗端末 · 実データ' : '実データ'}>
      {loading ? <Eyebrow>読み込み中…</Eyebrow> : !shopId ? (
        <Section label="勤怠"><Empty>所属店舗が見つかりません。</Empty></Section>
      ) : (
        <>
          {loadError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{loadError}</p>}
          {/* 打刻 */}
          <section style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 6 }}>今日の勤務</div>
              {openToday ? (
                <div style={{ fontSize: 15 }}>出勤中 <span style={{ fontFamily: mono, color: 'var(--noxa-accent-primary-ink)' }}>{hhmm(openToday.startMs)}〜</span> <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-muted)' }}>（{dur(openToday.startMs, now)}）</span></div>
              ) : <div style={{ fontSize: 14, color: 'var(--noxa-text-muted)' }}>未出勤</div>}
            </div>
            {openToday
              ? <button type="button" onClick={clockOut} disabled={busy} style={{ ...chip(true), minHeight: 48, padding: '0 28px', background: 'var(--noxa-accent-destructive)', borderColor: 'var(--noxa-accent-destructive)', fontSize: 15 }}>退勤</button>
              : <button type="button" onClick={clockIn} disabled={busy} style={{ ...chip(true), minHeight: 48, padding: '0 28px', fontSize: 15 }}>出勤</button>}
          </section>

          {/* 退勤忘れ警告（過去日の未退勤。放置すると給与計算で0分になる） */}
          {staleOpens.length > 0 && (
            <section style={{ background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--noxa-status-error)', fontWeight: 600, marginBottom: 6 }}>退勤の打刻忘れがあります</div>
              {staleOpens.map((s) => (
                <StaleOpenFixer key={s.id} shopId={shopId} shift={s} onFixed={() => reload(shopId)} />
              ))}
              <p style={{ fontSize: 11, color: 'var(--noxa-text-muted)', margin: '6px 0 0' }}>そのままだと給与計算に乗りません。実際の退勤時刻を入れて記録を締めてください。</p>
            </section>
          )}

          {todayDone.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--noxa-text-muted)', margin: '0 0 16px' }}>本日の完了勤務：{todayDone.map((s) => `${hhmm(s.startMs)}–${hhmm(s.endMs)}`).join(' / ')}</p>
          )}

          {/* 全キャストの当日/月次出勤状況（owner/manager のみ） */}
          {canOversee && <TeamAttendanceSection shopId={shopId} />}

          <ShiftCalendar shopId={shopId} uid={user.uid} shifts={shifts} />

          <Section label="勤怠履歴">
            {shifts.length === 0 ? <Empty>記録はまだありません。</Empty> : shifts.slice(0, 30).map((s) => (
              <ShiftRow key={s.id} shopId={shopId} shift={s} onChanged={() => reload(shopId)} />
            ))}
          </Section>
        </>
      )}
    </Shell>
  );
}

// ─────────────────────────────────────────────
// 打刻の修正（本人）
// rules: shifts write は owner/manager or 本人（castUid==auth.uid）＝本人の自己修正が可能。
// ─────────────────────────────────────────────

/** "HH:MM" と日付(YYYY-MM-DD)から Timestamp を作る */
function timeToTs(date: string, hm: string): Timestamp | null {
  if (!/^\d{2}:\d{2}$/.test(hm)) return null;
  const d = new Date(`${date}T${hm}:00`);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}
const toHm = (ms: number | null) => { if (!ms) return ''; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 退勤忘れ（過去日の未退勤）を実時刻入力で締める */
function StaleOpenFixer({ shopId, shift, onFixed }: { shopId: string; shift: Shift; onFixed: () => void }) {
  const [hm, setHm] = useState('23:59');
  const [busy, setBusy] = useState(false);
  const fix = async () => {
    const ts = timeToTs(shift.date, hm);
    if (!ts || busy) return;
    setBusy(true);
    try { await updateDoc(doc(db, `shop_shops/${shopId}/shifts/${shift.id}`), { endAt: ts, fixedAt: serverTimestamp() }); onFixed(); }
    catch (e) { window.alert(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: mono, padding: '4px 0' }}>
      <span style={{ minWidth: 84 }}>{shift.date}</span>
      <span>{hhmm(shift.startMs)}〜</span>
      <input type="time" value={hm} onChange={(e) => setHm(e.target.value)} style={{ minHeight: 32, padding: '2px 8px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontFamily: mono, fontSize: 12 }} />
      <button type="button" onClick={fix} disabled={busy} style={{ minHeight: 32, padding: '2px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--noxa-accent-primary)', border: 'none', color: '#fff', fontSize: 12 }}>この時刻で退勤</button>
    </div>
  );
}

/** 勤怠履歴の1行（本人による打刻修正・削除つき） */
function ShiftRow({ shopId, shift, onChanged }: { shopId: string; shift: Shift; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toHm(shift.startMs));
  const [end, setEnd] = useState(toHm(shift.endMs));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const st = timeToTs(shift.date, start);
    const en = end ? timeToTs(shift.date, end) : null;
    if (!st) { window.alert('出勤時刻が不正です'); return; }
    if (en && en.toMillis() <= st.toMillis()) { window.alert('退勤時刻は出勤より後にしてください'); return; }
    setBusy(true);
    try {
      await updateDoc(doc(db, `shop_shops/${shopId}/shifts/${shift.id}`), { startAt: st, ...(en ? { endAt: en } : {}), fixedAt: serverTimestamp() });
      setEditing(false); onChanged();
    } catch (e) { window.alert(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`${shift.date} の打刻記録を削除しますか？`)) return;
    setBusy(true);
    try { await deleteDoc(doc(db, `shop_shops/${shopId}/shifts/${shift.id}`)); onChanged(); }
    catch (e) { window.alert(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const tf: React.CSSProperties = { minHeight: 32, padding: '2px 6px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontFamily: mono, fontSize: 12, width: 92 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)', minWidth: 84 }}>{shift.date}</span>
      {editing ? (
        <>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={tf} />
          <span style={{ fontFamily: mono, fontSize: 12 }}>–</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={tf} />
          <span style={{ flex: 1 }} />
          <button type="button" onClick={save} disabled={busy} style={{ minHeight: 30, padding: '2px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--noxa-accent-primary)', border: 'none', color: '#fff', fontSize: 12 }}>保存</button>
          <button type="button" onClick={remove} disabled={busy} style={{ minHeight: 30, padding: '2px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-status-error)', fontSize: 12 }}>削除</button>
          <button type="button" onClick={() => setEditing(false)} style={{ minHeight: 30, padding: '2px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 12 }}>×</button>
        </>
      ) : (
        <>
          <span style={{ fontFamily: mono, fontSize: 13, flex: 1 }}>{hhmm(shift.startMs)} – {shift.endMs ? hhmm(shift.endMs) : <span style={{ color: 'var(--noxa-accent-primary-ink)' }}>勤務中</span>}</span>
          <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--noxa-text-faint)' }}>{dur(shift.startMs, shift.endMs)}</span>
          <button type="button" onClick={() => { setStart(toHm(shift.startMs)); setEnd(toHm(shift.endMs)); setEditing(true); }} title="打刻を修正" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 12 }}>✎</button>
        </>
      )}
    </div>
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

// ─────────────────────────────────────────────
// 全キャストの勤怠横断一覧（owner/manager）
// 当月 shifts を範囲クエリで取得し、キャスト別の当日状況＋月間合計を表示。
// ─────────────────────────────────────────────

function TeamAttendanceSection({ shopId }: { shopId: string }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [teamShifts, setTeamShifts] = useState<TeamShift[] | null>(null);
  // 集計基準時刻（render 中の Date.now() を避け、取得完了時に確定する）
  const [asOf, setAsOf] = useState<{ nowMs: number; todayKey: string }>(() => ({ nowMs: Date.now(), todayKey: shiftDateKey() }));
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  // メンバー表示名（members.castDisplayName）
  useEffect(() => {
    let alive = true;
    getDocs(collection(db, `shop_shops/${shopId}/members`)).then((snap) => {
      if (!alive) return;
      const m: Record<string, string> = {};
      snap.forEach((d) => { const v = d.data() as { castDisplayName?: string; kind?: string }; if (v.kind !== 'device') m[d.id] = v.castDisplayName || d.id.slice(0, 8); });
      setNames(m);
    }).catch(() => { /* 名前解決できなくても uid 先頭で表示 */ });
    return () => { alive = false; };
  }, [shopId]);

  // 当月分の全キャスト shifts（date 範囲クエリ・全件購読はしない）
  useEffect(() => {
    let alive = true;
    const mm = String(cursor.m).padStart(2, '0');
    const start = `${cursor.y}-${mm}-01`;
    const end = cursor.m === 12 ? `${cursor.y + 1}-01-01` : `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`;
    getDocs(query(collection(db, `shop_shops/${shopId}/shifts`), where('date', '>=', start), where('date', '<', end)))
      .then((snap) => {
        if (!alive) return;
        const list: TeamShift[] = [];
        snap.forEach((d) => { const v = d.data() as DocumentData; list.push({ castUid: (v.castUid as string) ?? '', date: (v.date as string) ?? '', startMs: toMs(v.startAt), endMs: toMs(v.endAt) }); });
        setTeamShifts(list); setAsOf({ nowMs: Date.now(), todayKey: shiftDateKey() }); setErr(null);
      })
      .catch((e) => { if (alive) { setTeamShifts([]); setErr(`チーム勤怠の取得に失敗（${(e as { code?: string }).code ?? (e as Error).message}）`); } });
    return () => { alive = false; };
  }, [shopId, cursor.y, cursor.m]);

  const rows = useMemo(() => summarizeTeamShifts(teamShifts ?? [], asOf.todayKey, asOf.nowMs), [teamShifts, asOf]);
  const fmtH = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  const move = (dir: -1 | 1) => setCursor((c) => { const d = new Date(c.y, c.m - 1 + dir, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const workingCount = rows.filter((r) => r.today === 'working').length;

  return (
    <Section label={`チーム勤怠（出勤中 ${workingCount}人）`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <button type="button" onClick={() => move(-1)} style={navBtn}>‹</button>
        <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 16, fontWeight: 600 }}>{cursor.y}.{String(cursor.m).padStart(2, '0')}</span>
        <button type="button" onClick={() => move(1)} style={navBtn}>›</button>
        <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--noxa-text-faint)' }}>当日状況と月間合計（owner/manager のみ表示）</span>
      </div>
      {err && <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--noxa-status-error)' }}>{err}</p>}
      {teamShifts === null ? <Eyebrow>読み込み中…</Eyebrow>
        : rows.length === 0 ? <Empty>この月の打刻はまだありません。</Empty>
        : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <div key={r.castUid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: `1px solid ${r.today === 'working' ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, flexWrap: 'wrap' }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, flex: 'none',
                background: r.today === 'working' ? 'var(--noxa-status-success)' : r.today === 'done' ? 'var(--noxa-text-muted)' : 'var(--noxa-border-strong)',
                boxShadow: r.today === 'working' ? '0 0 8px var(--noxa-status-success)' : 'none' }} />
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[r.castUid] ?? r.castUid.slice(0, 8)}</span>
              <span style={{ fontFamily: mono, fontSize: 12, minWidth: 110 }}>
                {r.today === 'working' ? <>出勤中 {hhmm(r.todayStartMs)}〜</> : r.today === 'done' ? `本日 ${fmtH(r.todayMinutes)}` : '本日 未出勤'}
              </span>
              <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>月 {r.monthDays}日 · {fmtH(r.monthMinutes)}</span>
              {r.staleOpenCount > 0 && <span title="過去日の退勤忘れ" style={{ fontSize: 10, color: 'var(--noxa-status-error)', fontFamily: mono }}>⚠ 退勤忘れ{r.staleOpenCount}</span>}
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--noxa-text-faint)', lineHeight: 1.6 }}>※ 過去日の退勤忘れは時間に計上されません（本人の勤怠画面で締められます）。</p>
    </Section>
  );
}

const navBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, cursor: 'pointer', background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 18 };
const calField: React.CSSProperties = { minHeight: 40, padding: '6px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 14, fontFamily: mono };

export default AttendanceClient;
