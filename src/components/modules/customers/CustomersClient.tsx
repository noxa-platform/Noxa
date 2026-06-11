'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
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
        />
      )}

      <p style={{ margin: '16px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>
        ※ {place}の台帳（noxa-platform 共有）。評価は★（SS〜C）。カードをタップで編集。
        {!shop.shopId && <> 店舗で使うには上部の <Link href="/seating" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗</Link> に切替。</>}
      </p>
    </div>
  );
}

function CustomerDialog({ initial, title, onClose, onSave, onDelete }: {
  initial: { name: string; stars: number }; title: string;
  onClose: () => void; onSave: (name: string, stars: number) => Promise<void>; onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [stars, setStars] = useState(initial.stars);
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
