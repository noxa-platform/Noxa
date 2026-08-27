'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc, serverTimestamp, type DocumentData } from 'firebase/firestore';
import { describeFirestoreError } from '@/lib/firestore-error';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { stampIrVersion } from '@/lib/ir-version';
import { resolveScheduleDate } from '@/lib/schedule/item-date';

/**
 * スケジュール — Noxa OS 個人機能（実データ）
 * personal_reminders/{uid}/items に出勤/イベント/MTG 等を保存（本人のみ）。
 */
const mono = 'var(--noxa-font-mono)';
// 既定の種別（個人で追加・削除可。保存先 personal_self_styles/{uid}.scheduleKinds）
const KINDS = ['出勤', 'イベント', 'MTG', 'アフター', 'その他'];
const KIND_COLOR: Record<string, string> = { 出勤: 'var(--noxa-accent-primary)', イベント: 'var(--noxa-accent-primary-ink)', MTG: '#67E8F9', アフター: '#F5D472', その他: 'var(--noxa-text-faint)' };

type Item = { id: string; title: string; date: string; kind: string; note?: string };

/**
 * doc を画面の 1 行にする。
 *
 * ⚠️ 日付の決定は `resolveScheduleDate` に切り出した（**同じコレクションに Web と iOS の
 * 2 つの書き方が混ざっている**ため。理由と経緯はそちらの冒頭に書いてある）。
 * ⚠️ 読めないときは `''` のままにし、**「過去」に混ぜない**（呼び出し側で分ける）。
 */
function mapItem(id: string, d: DocumentData): Item {
  return {
    id,
    title: (d.title as string) ?? '（無題）',
    date: resolveScheduleDate(d as Record<string, unknown>) ?? '',
    kind: (d.kind as string) ?? 'その他',
    note: (d.note as string) ?? '',
  };
}

export function ScheduleClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState(KINDS[0]);
  const [kinds, setKinds] = useState<string[]>(KINDS);
  const [editKinds, setEditKinds] = useState(false);
  const [newKind, setNewKind] = useState('');
  const [busy, setBusy] = useState(false);
  // 追加・削除・種別保存の失敗（旧実装は catch 無し／握り潰しで無音だった）
  const [opError, setOpError] = useState<string | null>(null);
  // 一覧の読み取り失敗（「予定なし」と区別する・Day110）
  const [readError, setReadError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const snap = await getDocs(collection(db, `personal_reminders/${user.uid}/items`));
      const list: Item[] = []; snap.forEach((d) => list.push(mapItem(d.id, d.data())));
      setItems(list); setReadError(null);
    } catch (e) {
      // 握り潰すと「予定はありません」と同じ表示になり、入っている予定を見落とす（Day110）
      setReadError(describeFirestoreError(e, '予定の読み込み'));
    }
    setLoading(false);
  };
  // 初回ロードは then 形式（async 関数の同期区間から辿れる setState を避ける・set-state-in-effect 対応）。
  // 追加/削除後の再読込はハンドラから reload を呼ぶ
  useEffect(() => {
    let alive = true;
    getDocs(collection(db, `personal_reminders/${user.uid}/items`))
      .then((snap) => {
        if (!alive) return;
        const list: Item[] = []; snap.forEach((d) => list.push(mapItem(d.id, d.data())));
        setItems(list); setReadError(null); setLoading(false);
      })
      .catch((e) => { if (alive) { setReadError(describeFirestoreError(e, '予定の読み込み')); setLoading(false); } });
    return () => { alive = false; };
  }, [user.uid]);

  // 個人のカスタム種別を読み込み（無ければ既定）
  useEffect(() => {
    (async () => {
      try {
        const s = await getDoc(doc(db, `personal_self_styles/${user.uid}`));
        const k = s.exists() ? (s.data()?.scheduleKinds as unknown) : null;
        if (Array.isArray(k) && k.length) { const list = k.filter((x): x is string => typeof x === 'string' && !!x); if (list.length) { setKinds(list); setKind(list[0]); } }
      } catch { /* 既定のまま */ }
    })();
  }, [user.uid]);

  // 種別の保存（本人のみ・既存予定の kind 文字列はそのまま残る）
  const saveKinds = async (next: string[]) => {
    const prevKinds = kinds; const prevKind = kind;
    setKinds(next);
    if (!next.includes(kind)) setKind(next[0] ?? '');
    setOpError(null);
    try {
      await setDoc(doc(db, `personal_self_styles/${user.uid}`), { scheduleKinds: next, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      // 握り潰すと「保存されていないのに画面だけ変わった」状態が残る（再読込で消える）
      setKinds(prevKinds); setKind(prevKind);
      setOpError(describeFirestoreError(e, '種別の保存'));
    }
  };

  const sorted = useMemo(() => [...items].sort((a, b) => a.date.localeCompare(b.date)), [items]);
  const today = new Date().toISOString().slice(0, 10);
  // ⚠️ **日付が読めないものを「過去」に混ぜない**（P156）。旧実装は `'' < today` が真なので
  // 黙って履歴へ落としていた。「別の日だった」と「日付が読めない」は別のこと（P154-PM2）
  const undated = sorted.filter((i) => !i.date);
  const upcoming = sorted.filter((i) => i.date && i.date >= today);
  const past = sorted.filter((i) => i.date && i.date < today).reverse();

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true); setOpError(null);
    try {
      await addDoc(collection(db, `personal_reminders/${user.uid}/items`), stampIrVersion({ title: title.trim(), date, kind, createdAt: serverTimestamp() }));
      setTitle(''); await reload();
    } catch (e) {
      // catch が無いと、登録できていないのに入力が残るだけで成功と区別がつかない
      setOpError(describeFirestoreError(e, '予定の登録'));
    } finally { setBusy(false); }
  };
  // 一覧からの除去は削除が成功してから（旧実装は先に画面から消しており、
  // 失敗すると「消えたはずの予定が再読込で戻る」状態になっていた）
  const remove = async (id: string) => {
    setOpError(null);
    try {
      await deleteDoc(doc(db, `personal_reminders/${user.uid}/items/${id}`));
      setItems((p) => p.filter((x) => x.id !== id));
    } catch (e) { setOpError(describeFirestoreError(e, '予定の削除')); }
  };

  return (
    <Shell title="スケジュール" eyebrow="ノクサ · スケジュール" crumb="schedule">
      {readError && (
        <p role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, fontSize: 13, color: 'var(--noxa-status-error)', background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{readError} 予定が無いのではなく、読み込めていません。</p>
      )}
      {opError && (
        <p role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, fontSize: 13, color: 'var(--noxa-status-error)', background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{opError}</p>
      )}
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
          <span style={lbl}>種別 <button type="button" onClick={() => setEditKinds((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-accent-primary-ink)', fontSize: 10, fontFamily: mono }}>{editKinds ? '完了' : '編集'}</button></span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {kinds.map((k) => editKinds ? (
              <span key={k} style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>{k}<button type="button" onClick={() => saveKinds(kinds.filter((x) => x !== k))} title="削除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--noxa-text-faint)', fontSize: 13, padding: 0 }}>×</button></span>
            ) : (
              <button key={k} type="button" onClick={() => setKind(k)} style={chip(kind === k)}>{k}</button>
            ))}
          </div>
          {editKinds && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <input value={newKind} onChange={(e) => setNewKind(e.target.value)} placeholder="種別を追加" style={{ ...field, minHeight: 34, fontSize: 13, width: 140 }} />
              <button type="button" onClick={() => { const n = newKind.trim(); if (n && !kinds.includes(n)) { saveKinds([...kinds, n]); setNewKind(''); } }} style={chip(true)}>追加</button>
            </div>
          )}
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
          {/* ⚠️ 黙って「過去」に混ぜない（P156）。ふだんは 0 件なのでセクションごと出さない */}
          {undated.length > 0 && (
            <Section label="日付が読めない予定">
              <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--noxa-status-warning)' }}>
                日付を読み取れなかった予定が {undated.length} 件あります（別のアプリで作られた可能性があります）。予定が無いのではなく、日付だけが読めていません。
              </p>
              {undated.map((i) => <Row key={i.id} item={i} onRemove={() => remove(i.id)} dim />)}
            </Section>
          )}
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
