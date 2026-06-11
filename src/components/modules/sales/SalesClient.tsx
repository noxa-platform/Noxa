'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import type { User } from 'firebase/auth';

/**
 * 売上（最小版・yorulog ベースを最低限で移植）。
 * - ワークスペース連動：店舗=shop_shops/{id}/sales、個人=personal_sales/{uid}/items
 * - 手入力で売上を記録／本日・今月・累計の集計／取消(無効化)・金額修正。AI・予測等は持たない。
 * - POS会計から転記された売上もここに混ざって表示される（同じ sales コレクション）。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

function todayKey(): string { const d = new Date(); if (d.getHours() < 6) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function toMs(v: unknown): number | null { if (v instanceof Timestamp) return v.toMillis(); if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000; return null; }

type Sale = { id: string; amount: number; customerName: string | null; castName: string | null; dayKey: string; atMs: number | null; voided: boolean; source: string };

export function SalesClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const colPath = shop.shopId ? `shop_shops/${shop.shopId}/sales` : `personal_sales/${user.uid}/items`;
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (shop.loading) return;
    setLoading(true);
    const unsub = onSnapshot(collection(db, colPath), (snap) => {
      const list: Sale[] = [];
      snap.forEach((d) => { const x = d.data() as DocumentData; list.push({ id: d.id, amount: typeof x.amount === 'number' ? x.amount : 0, customerName: x.customerName ?? null, castName: x.castName ?? null, dayKey: x.dayKey ?? '', atMs: toMs(x.checkoutAt) ?? toMs(x.createdAt), voided: x.voided === true, source: x.source ?? 'manual' }); });
      setSales(list); setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [colPath, shop.loading]);

  const tk = todayKey();
  const mk = tk.slice(0, 7);
  const sum = useMemo(() => {
    let today = 0, month = 0, total = 0, count = 0;
    for (const s of sales) { if (s.voided) continue; total += s.amount; count += 1; if (s.dayKey === tk) today += s.amount; if ((s.dayKey || '').slice(0, 7) === mk) month += s.amount; }
    return { today, month, total, count };
  }, [sales, tk, mk]);
  const recent = useMemo(() => [...sales].sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0)).slice(0, 40), [sales]);
  const place = shop.shopId ? '店舗' : '個人';

  const addSale = async (amount: number, customerName: string, castName: string) => {
    // castUid=記録者（店舗ルールの create 条件を満たし、個人売上の帰属にもなる）
    await addDoc(collection(db, colPath), { source: 'manual', amount, customerName: customerName.trim() || null, castName: castName.trim() || null, castUid: user.uid, operatorUid: user.uid, dayKey: tk, checkoutAt: serverTimestamp(), createdAt: serverTimestamp() });
  };
  const voidSale = async (s: Sale) => { const r = window.prompt('取消理由（任意）'); if (r === null) return; await updateDoc(doc(db, `${colPath}/${s.id}`), { voided: true, voidedAt: serverTimestamp(), voidReason: r }); };
  const editSale = async (s: Sale) => { const v = window.prompt('金額（円）', String(s.amount)); if (v === null) return; const a = Number(v); if (!Number.isFinite(a) || a < 0) return; await updateDoc(doc(db, `${colPath}/${s.id}`), { amount: a, correctedAt: serverTimestamp() }); };

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>売上 · {place}</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>売上</h1>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="noxa-btn noxa-btn-primary">＋ 売上を記録</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12, marginBottom: 18 }}>
        <Kpi label="本日" value={yen(sum.today)} accent />
        <Kpi label="今月" value={yen(sum.month)} />
        <Kpi label="累計" value={yen(sum.total)} />
        <Kpi label="件数" value={`${sum.count} 件`} />
      </div>

      {loading ? (
        <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
      ) : recent.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed var(--noxa-border-strong)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
          <p style={{ margin: '0 0 6px', fontSize: 15 }}>まだ売上がありません。</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>「＋ 売上を記録」から手入力できます。POSで会計するとここにも自動で計上されます。</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recent.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: s.voided ? 0.5 : 1 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', minWidth: 70 }}>{s.atMs ? new Date(s.atMs).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : s.dayKey}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.customerName ?? '（名無し）'}{s.castName && <span style={{ color: 'var(--noxa-text-muted)' }}> / {s.castName}</span>}
                {s.source === 'pos' && <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', marginLeft: 6 }}>POS</span>}
                {s.voided && <span style={{ color: 'var(--noxa-status-error)', fontSize: 11, marginLeft: 6 }}>取消</span>}
              </span>
              <span style={{ fontFamily: mono, fontSize: 14, fontVariantNumeric: 'tabular-nums', textDecoration: s.voided ? 'line-through' : 'none' }}>{yen(s.amount)}</span>
              {!s.voided && <>
                <button type="button" onClick={() => editSale(s)} style={miniBtn}>修正</button>
                <button type="button" onClick={() => voidSale(s)} style={{ ...miniBtn, color: 'var(--noxa-status-error)' }}>取消</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {adding && <SaleDialog onClose={() => setAdding(false)} onSave={async (a, c, k) => { await addSale(a, c, k); setAdding(false); }} />}

      <p style={{ margin: '16px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>
        ※ {place}の売上（noxa-platform 共有）。取消は無効化＝集計から除外。
        {!shop.shopId && <> 店舗の売上は上部で <Link href="/seating" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗</Link> に切替。</>}
      </p>
    </div>
  );
}

function SaleDialog({ onClose, onSave }: { onClose: () => void; onSave: (amount: number, customer: string, cast: string) => Promise<void> }) {
  const [amount, setAmount] = useState<number>(0);
  const [customer, setCustomer] = useState('');
  const [cast, setCast] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div role="dialog" aria-label="売上を記録" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 94vw)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 700 }}>売上を記録</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>金額（円）</span>
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} className="noxa-input" autoFocus /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>お客様名（任意）</span>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="例：田中様" className="noxa-input" /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>担当（任意）</span>
          <input value={cast} onChange={(e) => setCast(e.target.value)} className="noxa-input" /></label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" disabled={amount <= 0 || busy} onClick={async () => { setBusy(true); try { await onSave(amount, customer, cast); } finally { setBusy(false); } }} className="noxa-btn noxa-btn-primary" style={{ flex: 1 }}>{busy ? '保存中…' : '記録する'}</button>
          <button type="button" onClick={onClose} className="noxa-btn noxa-btn-secondary" style={{ width: 90 }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 11, cursor: 'pointer', flex: 'none' };

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 24, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: accent ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{value}</span>
    </div>
  );
}

export default SalesClient;
