'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, getDocs, serverTimestamp, increment, query, where, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import { businessDayKey } from '@/lib/datetime';
import type { User } from 'firebase/auth';

/**
 * 売上（最小版・yorulog ベースを最低限で移植）。
 * - ワークスペース連動：店舗=shop_shops/{id}/sales、個人=personal_sales/{uid}/items
 * - 手入力で売上を記録／本日・今月・累計の集計／取消(無効化)・金額修正。AI・予測等は持たない。
 * - POS会計から転記された売上もここに混ざって表示される（同じ sales コレクション）。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

function toMs(v: unknown): number | null { if (v instanceof Timestamp) return v.toMillis(); if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000; return null; }

type Sale = { id: string; amount: number; customerName: string | null; customerId: string | null; castName: string | null; dayKey: string; atMs: number | null; voided: boolean; source: string; nomination: string | null; dohan: boolean; unpaidAmount: number };

export function SalesClient({ user }: { user: User }) {
  const shop = useShopId(user);
  const colPath = shop.shopId ? `shop_shops/${shop.shopId}/sales` : `personal_sales/${user.uid}/items`;
  // 売上・顧客は「どのパス/店の購読か」つきで保持し、loading と表示リストを導出する
  // （effect 冒頭の同期 setState は react-hooks/set-state-in-effect 違反。Day17 返済）
  const [salesSnap, setSalesSnap] = useState<{ colPath: string; list: Sale[] } | null>(null);
  const [customersSnap, setCustomersSnap] = useState<{ shopId: string; list: { id: string; name: string }[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [opBusy, setOpBusy] = useState(false); // 取消/修正の二重実行防止

  const sales = useMemo(() => (salesSnap?.colPath === colPath ? salesSnap.list : []), [salesSnap, colPath]);
  const customers = useMemo(
    () => (shop.shopId && customersSnap?.shopId === shop.shopId ? customersSnap.list : []),
    [customersSnap, shop.shopId],
  );
  const loading = shop.loading || salesSnap?.colPath !== colPath;

  // 店舗ワークスペース時のみ顧客台帳を購読（手入力売上の顧客紐付け用）
  useEffect(() => {
    const sid = shop.shopId;
    if (!sid) return;
    const unsub = onSnapshot(collection(db, `shop_shops/${sid}/customers`), (snap) => {
      const list: { id: string; name: string }[] = [];
      snap.forEach((d) => { const x = d.data() as DocumentData; list.push({ id: d.id, name: (x.name as string) ?? '（無名）' }); });
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setCustomersSnap({ shopId: sid, list });
    }, () => setCustomersSnap({ shopId: sid, list: [] }));
    return () => unsub();
  }, [shop.shopId]);

  useEffect(() => {
    if (shop.loading) return;
    // 期間クエリ化: 当月分のみ購読（全件購読は数ヶ月で read 数が破綻する）。
    // dayKey は businessDayKey 形式（YYYY-MM-DD）なので範囲条件で当月を取る。
    const monthStart = `${businessDayKey().slice(0, 7)}-01`;
    const unsub = onSnapshot(query(collection(db, colPath), where('dayKey', '>=', monthStart)), (snap) => {
      const list: Sale[] = [];
      snap.forEach((d) => { const x = d.data() as DocumentData; list.push({
        // amount が無い旧 CF 控えは salesAmount を表示に使う（個人控えのスキーマ互換）
        id: d.id, amount: typeof x.amount === 'number' ? x.amount : (typeof x.salesAmount === 'number' ? x.salesAmount : 0),
        customerName: x.customerName ?? null, customerId: x.customerId ?? null, castName: x.castName ?? null, dayKey: x.dayKey ?? '',
        atMs: toMs(x.checkoutAt) ?? toMs(x.datetime) ?? toMs(x.createdAt), voided: x.voided === true, source: x.source ?? 'manual',
        nomination: typeof x.nomination === 'string' ? x.nomination : null, dohan: x.dohan === true,
        unpaidAmount: typeof x.unpaidAmount === 'number' ? x.unpaidAmount : 0,
      }); });
      setSalesSnap({ colPath, list }); setLoadError(null);
    }, (e) => { setSalesSnap({ colPath, list: [] }); setLoadError(`売上の読み込みに失敗しました（${e.code ?? e.message}）`); });
    return () => unsub();
  }, [colPath, shop.loading]);

  const tk = businessDayKey();
  const mk = tk.slice(0, 7);
  const sum = useMemo(() => {
    let today = 0, month = 0, total = 0, count = 0;
    for (const s of sales) { if (s.voided) continue; total += s.amount; count += 1; if (s.dayKey === tk) today += s.amount; if ((s.dayKey || '').slice(0, 7) === mk) month += s.amount; }
    return { today, month, total, count };
  }, [sales, tk, mk]);
  const recent = useMemo(() => [...sales].sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0)).slice(0, 40), [sales]);
  const place = shop.shopId ? '店舗' : '個人';

  const custRef = (cid: string) => shop.shopId ? doc(db, `shop_shops/${shop.shopId}/customers/${cid}`) : null;
  const addSale = async (amount: number, customerName: string, castName: string, customerId: string | null) => {
    // castUid=記録者（店舗ルールの create 条件を満たし、個人売上の帰属にもなる）
    await addDoc(collection(db, colPath), { source: 'manual', entryMode: 'amount', amount, customerName: customerName.trim() || null, customerId: customerId || null, castName: castName.trim() || null, castUid: user.uid, operatorUid: user.uid, dayKey: tk, checkoutAt: serverTimestamp(), createdAt: serverTimestamp() });
    // 顧客紐付け時は POS会計と同様に顧客実績へ反映（店舗ワークスペースのみ）
    if (customerId) { const cr = custRef(customerId); if (cr) await updateDoc(cr, { totalSales: increment(amount), visitCount: increment(1), lastContactAt: serverTimestamp() }).catch(() => {}); }
  };
  const voidSale = async (s: Sale) => {
    if (opBusy || s.voided) return;
    const r = window.prompt('取消理由（任意）'); if (r === null) return;
    setOpBusy(true);
    try {
      await updateDoc(doc(db, `${colPath}/${s.id}`), { voided: true, voidedAt: serverTimestamp(), voidReason: r });
      // 顧客実績から減算（取消＝集計から外す）
      if (s.customerId) { const ref = custRef(s.customerId); if (ref) await updateDoc(ref, { totalSales: increment(-s.amount), visitCount: increment(-1) }).catch(() => {}); }
      // ツケ会計の取消: 紐付く未収起票も削除（発生源が消えた台帳を残さない）。
      // unpaid の権限（owner/manager/accounting）が無いロールでは残るため、その旨を通知する
      if (shop.shopId && s.unpaidAmount > 0) {
        try {
          const linked = await getDocs(query(collection(db, `shop_shops/${shop.shopId}/unpaid`), where('saleId', '==', s.id)));
          await Promise.all(linked.docs.map((d) => deleteDoc(d.ref)));
        } catch {
          window.alert('売上は取消しましたが、紐付く未収（ツケ）の削除権限がありません。売掛管理から削除してください。');
        }
      }
    } finally { setOpBusy(false); }
  };
  const editSale = async (s: Sale) => {
    if (opBusy || s.voided) return;
    const v = window.prompt('金額（円）', String(s.amount)); if (v === null) return; const a = Number(v); if (!Number.isFinite(a) || a < 0) return;
    setOpBusy(true);
    try {
      await updateDoc(doc(db, `${colPath}/${s.id}`), { amount: a, correctedAt: serverTimestamp() });
      // 顧客の累計売上も差額で補正
      if (s.customerId && a !== s.amount) { const ref = custRef(s.customerId); if (ref) await updateDoc(ref, { totalSales: increment(a - s.amount) }).catch(() => {}); }
    } finally { setOpBusy(false); }
  };

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>売上 · {place}</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>売上</h1>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="noxa-btn noxa-btn-primary">＋ 売上を記録</button>
      </div>

      {loadError && <p role="alert" style={{ color: 'var(--noxa-status-error)', fontSize: 13, margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(229,115,115,0.08)', border: '1px solid var(--noxa-status-error)' }}>{loadError}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12, marginBottom: 18 }}>
        <Kpi label="本日" value={yen(sum.today)} accent />
        <Kpi label="今月" value={yen(sum.month)} />
        {/* 期間クエリ化に伴い累計→今月件数へ（全期間集計は月次レポートで） */}
        <Kpi label="今月件数" value={`${sum.count} 件`} />
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
                {s.nomination === 'main' && <span style={{ fontSize: 10, color: 'var(--noxa-accent-primary-ink)', marginLeft: 6 }}>本指名</span>}
                {s.nomination === 'inTable' && <span style={{ fontSize: 10, color: 'var(--noxa-status-info)', marginLeft: 6 }}>場内</span>}
                {s.dohan && <span style={{ fontSize: 10, color: 'var(--noxa-status-warning)', marginLeft: 6 }}>同伴</span>}
                {s.unpaidAmount > 0 && <span title={`うち未収 ¥${s.unpaidAmount.toLocaleString('ja-JP')}`} style={{ fontSize: 10, color: 'var(--noxa-status-error)', marginLeft: 6 }}>ツケ{yen(s.unpaidAmount)}</span>}
                {s.voided && <span style={{ color: 'var(--noxa-status-error)', fontSize: 11, marginLeft: 6 }}>取消</span>}
              </span>
              <span style={{ fontFamily: mono, fontSize: 14, fontVariantNumeric: 'tabular-nums', textDecoration: s.voided ? 'line-through' : 'none' }}>{yen(s.amount)}</span>
              {!s.voided && <>
                <button type="button" disabled={opBusy} onClick={() => editSale(s)} style={{ ...miniBtn, opacity: opBusy ? 0.5 : 1 }}>修正</button>
                <button type="button" disabled={opBusy} onClick={() => voidSale(s)} style={{ ...miniBtn, color: 'var(--noxa-status-error)', opacity: opBusy ? 0.5 : 1 }}>取消</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {adding && <SaleDialog customers={customers} onClose={() => setAdding(false)} onSave={async (a, c, k, cid) => { await addSale(a, c, k, cid); setAdding(false); }} />}

      <p style={{ margin: '16px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>
        ※ {place}の売上（noxa-platform 共有）。取消は無効化＝集計から除外。
        {!shop.shopId && <> 店舗の売上は上部で <Link href="/seating" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗</Link> に切替。</>}
      </p>
    </div>
  );
}

function SaleDialog({ customers, onClose, onSave }: { customers: { id: string; name: string }[]; onClose: () => void; onSave: (amount: number, customer: string, cast: string, customerId: string | null) => Promise<void> }) {
  const [amount, setAmount] = useState<number>(0);
  const [customer, setCustomer] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [cast, setCast] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div role="dialog" aria-label="売上を記録" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 94vw)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 700 }}>売上を記録</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>金額（円）</span>
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} className="noxa-input" autoFocus /></label>
        {customers.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>既存の顧客から選ぶ（任意）</span>
            <select value={customerId} onChange={(e) => { const id = e.target.value; setCustomerId(id); const c = customers.find((x) => x.id === id); if (c) setCustomer(c.name); }} className="noxa-input">
              <option value="">— 選択しない —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>お客様名（任意）</span>
          <input value={customer} onChange={(e) => { setCustomer(e.target.value); }} placeholder="例：田中様" className="noxa-input" /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="noxa-label" style={{ margin: 0 }}>担当（任意）</span>
          <input value={cast} onChange={(e) => setCast(e.target.value)} className="noxa-input" /></label>
        {customerId && <p style={{ margin: 0, fontSize: 11, color: 'var(--noxa-text-faint)' }}>※ 選択した顧客の累計売上・来店回数に反映されます。</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" disabled={amount <= 0 || busy} onClick={async () => { setBusy(true); try { await onSave(amount, customer, cast, customerId || null); } finally { setBusy(false); } }} className="noxa-btn noxa-btn-primary" style={{ flex: 1 }}>{busy ? '保存中…' : '記録する'}</button>
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
