'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { useShopRole, hasShopRole } from '@/lib/useShopRole';
import { rankToStars, starsToRank } from '@/lib/customerRank';
import type { User } from 'firebase/auth';

/**
 * 顧客台帳（最小版・yorulog ベースを最低限で移植）。
 * - 操作対象はワークスペース選択に追従：店舗なら shop_shops/{id}/customers、個人なら personal_customers/{uid}/items
 * - 評価は rank(SS/S/A/B/C) を ★5段階で表示・入力（iOS実データに一致）
 * - 一覧／検索／ランク絞り込み／追加／編集／削除のみ。AI・LINE取込等の複雑機能は持たない。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

type Cust = { id: string; name: string; totalSales: number; visitCount: number; lastContactAt: number | null; rank: string | null; castName: string | null };

function toMs(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  return null;
}
function mapCust(id: string, d: DocumentData): Cust {
  return {
    id, name: (d.name as string) ?? '（無名）',
    totalSales: typeof d.totalSales === 'number' ? d.totalSales : 0,
    visitCount: typeof d.visitCount === 'number' ? d.visitCount : 0,
    lastContactAt: toMs(d.lastContactAt), rank: (d.rank as string) ?? null,
    castName: (d.castName as string) ?? null,
  };
}
const fmtDate = (ms: number | null) => { if (!ms) return '—'; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };

/** ★表示（読み取り専用） */
function Stars({ rank, size = 14 }: { rank?: string | null; size?: number }) {
  const n = rankToStars(rank);
  if (n === 0) return <span style={{ fontSize: size - 2, color: 'var(--noxa-text-faint)' }}>未評価</span>;
  return <span aria-label={`星${n}`} style={{ fontSize: size, color: '#F5C451', letterSpacing: 1 }}>{'★'.repeat(n)}<span style={{ color: 'var(--noxa-border-strong)' }}>{'★'.repeat(5 - n)}</span></span>;
}
/** ★入力（クリックで選択） */
function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" aria-label={`星${s}`} onClick={() => onChange(value === s ? 0 : s)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 26, lineHeight: 1, padding: 0, color: s <= value ? '#F5C451' : 'var(--noxa-border-strong)' }}>★</button>
      ))}
    </span>
  );
}

type Sort = 'sales' | 'recent' | 'visits';

export function CustomersClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const colPath = shop.shopId ? `shop_shops/${shop.shopId}/customers` : `personal_customers/${user.uid}/items`;
  const [custs, setCusts] = useState<Cust[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>('sales');
  const [q, setQ] = useState('');
  const [starFilter, setStarFilter] = useState<number>(0); // 0=全部
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Day9: 担当割当・キャスト別成績（owner/manager のみ。API 側も同権限を検証）
  const roleCtx = useShopRole(user);
  const canTeam = !!shop.shopId && hasShopRole(roleCtx, ['manager']);
  const [tab, setTab] = useState<'list' | 'team'>('list');
  const [members, setMembers] = useState<{ uid: string; label: string }[]>([]);
  useEffect(() => {
    if (!shop.shopId || !canTeam) return;
    // 割当先候補 = 人間メンバー（端末を除く）。owner が接客する運用も許容（API と同基準）
    const unsub = onSnapshot(collection(db, `shop_shops/${shop.shopId}/members`), (snap) => {
      const list: { uid: string; label: string }[] = [];
      snap.forEach((d) => {
        const m = d.data() as { role?: string; castDisplayName?: string; kind?: string };
        if (m.kind === 'device') return;
        list.push({ uid: d.id, label: `${m.castDisplayName || d.id.slice(0, 8)}（${m.role ?? '?'}）` });
      });
      setMembers(list);
    }, () => setMembers([]));
    return () => unsub();
  }, [shop.shopId, canTeam]);

  const assignCustomer = async (customerId: string, castUid: string) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/team/assign-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shopId: shop.shopId, customerId, castUid }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `担当の割り当てに失敗しました（${res.status}）`);
  };

  useEffect(() => {
    if (shop.loading) return;
    setLoading(true);
    const unsub = onSnapshot(collection(db, colPath), (snap) => {
      const list: Cust[] = []; snap.forEach((d) => list.push(mapCust(d.id, d.data())));
      setCusts(list); setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [colPath, shop.loading]);

  const list = useMemo(() => {
    let l = custs.filter((c) => (!q || c.name.includes(q)) && (starFilter === 0 || rankToStars(c.rank) === starFilter));
    l = [...l].sort((a, b) => sort === 'sales' ? b.totalSales - a.totalSales : sort === 'visits' ? (b.visitCount || 0) - (a.visitCount || 0) : (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0));
    return l;
  }, [custs, sort, q, starFilter]);

  const editing = custs.find((c) => c.id === editId) ?? null;
  const place = shop.shopId ? '店舗' : '個人';

  const addCustomer = async (name: string, stars: number) => {
    await addDoc(collection(db, colPath), { name: name.trim(), rank: starsToRank(stars), totalSales: 0, visitCount: 0, tags: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  };
  const saveCustomer = async (id: string, name: string, stars: number) => {
    await updateDoc(doc(db, `${colPath}/${id}`), { name: name.trim(), rank: starsToRank(stars), updatedAt: serverTimestamp() });
  };
  const removeCustomer = async (id: string) => { await deleteDoc(doc(db, `${colPath}/${id}`)); };

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>顧客台帳 · {place}</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>顧客台帳</h1>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="noxa-btn noxa-btn-primary">＋ 顧客を追加</button>
      </div>

      {/* 一覧 / キャスト別成績 タブ（owner/manager のみ） */}
      {canTeam && (
        <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button type="button" role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')} style={chip(tab === 'list')}>顧客一覧</button>
          <button type="button" role="tab" aria-selected={tab === 'team'} onClick={() => setTab('team')} style={chip(tab === 'team')}>キャスト別成績</button>
        </div>
      )}

      {tab === 'team' && canTeam && shop.shopId ? (
        <TeamStatsPanel shopId={shop.shopId} user={user} />
      ) : (
      <>
      {/* 検索＋並び＋星フィルタ */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前で検索" className="noxa-input" style={{ flex: '1 1 200px' }} />
        <div style={{ display: 'flex', gap: 6 }}>
          {([['sales', '売上順'], ['recent', '最近順'], ['visits', '来店順']] as [Sort, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSort(k)} style={chip(sort === k)}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--noxa-text-faint)' }}>評価</span>
        <button type="button" onClick={() => setStarFilter(0)} style={chip(starFilter === 0)}>全部</button>
        {[5, 4, 3, 2, 1].map((s) => <button key={s} type="button" onClick={() => setStarFilter(s)} style={chip(starFilter === s)}>{'★'.repeat(s)}</button>)}
      </div>

      {loading ? (
        <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
      ) : custs.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed var(--noxa-border-strong)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 15 }}>まだ顧客がいません。</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>「＋ 顧客を追加」から登録できます（{place}の台帳）。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 12 }}>
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => setEditId(c.id)} style={{ appearance: 'none', textAlign: 'left', cursor: 'pointer', background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--noxa-text-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 38, height: 38, borderRadius: 19, background: 'linear-gradient(135deg,#8B5CF6,#C4384A)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, flex: 'none' }}>{c.name[0]}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <Stars rank={c.rank} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
                <Stat label="累計売上" value={yen(c.totalSales)} accent />
                <Stat label="来店" value={`${c.visitCount || 0}`} />
                <Stat label="最終" value={fmtDate(c.lastContactAt)} />
              </div>
            </button>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <CustomerDialog
          initial={editing ? { name: editing.name, stars: rankToStars(editing.rank) } : { name: '', stars: 0 }}
          title={editing ? '顧客を編集' : '顧客を追加'}
          onClose={() => { setAdding(false); setEditId(null); }}
          onSave={async (name, stars) => { if (editing) await saveCustomer(editing.id, name, stars); else await addCustomer(name, stars); setAdding(false); setEditId(null); }}
          onDelete={editing ? async () => { if (window.confirm(`${editing.name} を削除しますか？`)) { await removeCustomer(editing.id); setEditId(null); } } : undefined}
          assignTargets={canTeam && editing ? members : undefined}
          onAssign={canTeam && editing ? async (castUid) => { await assignCustomer(editing.id, castUid); setEditId(null); } : undefined}
        />
      )}

      <p style={{ margin: '16px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>
        ※ {place}の台帳（noxa-platform 共有）。評価は★（SS〜C）。カードをタップで編集。
        {!shop.shopId && <> 店舗で使うには上部の <Link href="/seating" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗</Link> に切替。</>}
      </p>
      </>
      )}
    </div>
  );
}

// ─────────────────────── キャスト別成績（owner/manager・Admin API 経由）

type MemberStat = { uid: string; name: string; role: string; customerCount: number; monthSales: number; monthGroupCount: number };
type CastCustomer = { id: string; name: string; rank: string | null; lastContactAt: string | null; totalSales: number };

function TeamStatsPanel({ shopId, user }: { shopId: string; user: User }) {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [rows, setRows] = useState<MemberStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null); // 展開中のキャスト uid
  const [selCustomers, setSelCustomers] = useState<CastCustomer[] | null>(null);
  const [selBusy, setSelBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/team/member-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shopId, year: ym.y, month: ym.m }),
        });
        const data = (await res.json().catch(() => ({}))) as { members?: MemberStat[]; error?: string };
        if (!alive) return;
        if (!res.ok) { setErr(data.error ?? `成績の取得に失敗しました（${res.status}）`); setRows([]); }
        else setRows(Array.isArray(data.members) ? data.members : []);
      } catch (e) {
        if (alive) { setErr(String((e as Error)?.message ?? e)); setRows([]); }
      } finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [shopId, ym.y, ym.m, user]);

  const toggleCast = async (uid: string) => {
    if (sel === uid) { setSel(null); setSelCustomers(null); return; }
    setSel(uid); setSelCustomers(null); setSelBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/team/cast-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId, castUid: uid }),
      });
      const data = (await res.json().catch(() => ({}))) as { customers?: CastCustomer[] };
      setSelCustomers(res.ok && Array.isArray(data.customers) ? data.customers : []);
    } catch { setSelCustomers([]); }
    finally { setSelBusy(false); }
  };

  const move = (dir: -1 | 1) => setYm((c) => { const d = new Date(c.y, c.m - 1 + dir, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });

  return (
    <section aria-label="キャスト別成績" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => move(-1)} style={chip(false)}>‹ 前月</button>
        <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 18, fontWeight: 600 }}>{ym.y}.{String(ym.m).padStart(2, '0')}</span>
        <button type="button" onClick={() => move(1)} style={chip(false)}>翌月 ›</button>
        {busy && <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>集計中…</span>}
      </div>
      {err && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--noxa-status-error)' }}>{err}</p>}
      {rows && rows.length === 0 && !busy && !err && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>キャスト（cast ロールのメンバー）がいません。店舗設定の「メンバーと招待」から招待できます。</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(rows ?? []).map((m) => (
          <div key={m.uid} style={{ borderRadius: 12, border: '1px solid var(--noxa-border)', background: 'var(--noxa-surface-card)' }}>
            <button type="button" onClick={() => toggleCast(m.uid)}
              style={{ appearance: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'none', border: 'none', color: 'var(--noxa-text-primary)', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}
                <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>{m.role}</span>
              </span>
              <Stat label="担当顧客" value={`${m.customerCount}`} />
              <Stat label="月間組数" value={`${m.monthGroupCount}`} />
              <Stat label="月間売上" value={yen(m.monthSales)} accent />
              <span aria-hidden style={{ color: 'var(--noxa-text-faint)' }}>{sel === m.uid ? '▲' : '▼'}</span>
            </button>
            {sel === m.uid && (
              <div style={{ borderTop: '1px solid var(--noxa-divider)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selBusy ? <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>読み込み中…</span>
                  : (selCustomers ?? []).length === 0 ? <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>担当顧客はまだいません。</span>
                  : (selCustomers ?? []).slice(0, 30).map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <Stars rank={c.rank} size={12} />
                      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', minWidth: 46 }}>{c.lastContactAt ? c.lastContactAt.slice(5, 10).replace('-', '/') : '—'}</span>
                      <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 84, textAlign: 'right' }}>{yen(c.totalSales)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--noxa-text-faint)', lineHeight: 1.6 }}>
        ※ 集計は各キャストの個人顧客台帳＋顧客なし日売（POS会計の自動転記を含む）。顧客の担当割当は「顧客一覧」タブのカード→「担当キャストへ割当」。
      </p>
    </section>
  );
}

function CustomerDialog({ initial, title, onClose, onSave, onDelete, assignTargets, onAssign }: {
  initial: { name: string; stars: number }; title: string;
  onClose: () => void; onSave: (name: string, stars: number) => Promise<void>; onDelete?: () => Promise<void>;
  /** 担当キャストへの割当（owner/manager・店舗の未担当顧客のみ） */
  assignTargets?: { uid: string; label: string }[];
  onAssign?: (castUid: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [stars, setStars] = useState(initial.stars);
  const [assignUid, setAssignUid] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div role="dialog" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 94vw)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 700 }}>{title}</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>お名前</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：田中様" className="noxa-input" autoFocus /></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>評価（★）</span><StarPicker value={stars} onChange={setStars} /></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); try { await onSave(name, stars); } finally { setBusy(false); } }} className="noxa-btn noxa-btn-primary" style={{ flex: 1 }}>{busy ? '保存中…' : '保存'}</button>
          <button type="button" onClick={onClose} className="noxa-btn noxa-btn-secondary" style={{ width: 90 }}>閉じる</button>
        </div>
        {/* 担当キャストへ割当（顧客台帳ごとキャストの個人台帳へ移動＝不可逆） */}
        {onAssign && (assignTargets?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--noxa-divider)', paddingTop: 12 }}>
            <span className="noxa-label" style={{ margin: 0 }}>担当キャストへ割当</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={assignUid} onChange={(e) => setAssignUid(e.target.value)} className="noxa-input" style={{ flex: 1 }}>
                <option value="">— キャストを選択 —</option>
                {assignTargets!.map((m) => <option key={m.uid} value={m.uid}>{m.label}</option>)}
              </select>
              <button type="button" disabled={!assignUid || busy} className="noxa-btn noxa-btn-secondary" style={{ width: 110, opacity: !assignUid || busy ? 0.6 : 1 }}
                onClick={async () => {
                  if (!assignUid) return;
                  if (!window.confirm(`${name || 'この顧客'} を担当キャストの台帳へ移動します（この一覧からは消えます）。よろしいですか？`)) return;
                  setBusy(true);
                  try { await onAssign(assignUid); } catch (e) { window.alert(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
                }}>割り当てる</button>
            </div>
            <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', lineHeight: 1.6 }}>来店履歴・ギフトごとキャストの個人台帳へ移動し、以後の成績は「キャスト別成績」タブに反映されます。</span>
          </div>
        )}
        {onDelete && <button type="button" onClick={onDelete} style={{ background: 'none', border: 'none', color: 'var(--noxa-status-error)', cursor: 'pointer', fontSize: 13 }}>この顧客を削除</button>}
      </div>
    </div>
  );
}

const chip = (on: boolean): React.CSSProperties => ({ appearance: 'none', cursor: 'pointer', minHeight: 40, padding: '7px 14px', borderRadius: 9999, fontSize: 13, fontWeight: on ? 600 : 400, background: on ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: on ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${on ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` });

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: accent ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{value}</span>
    </div>
  );
}

export default CustomersClient;
