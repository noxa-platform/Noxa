'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

/**
 * 顧客台帳 — Noxa OS 個人機能（実データ）
 * personal_customers/{uid}/items ＋ 自分が owner の shop_shops/{id}/customers を読み、
 * 顧客カード（名前・ランク・累計売上・来店・最終接触・タグ）を一覧表示。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

type Cust = {
  id: string; name: string; totalSales: number; visitCount: number;
  lastContactAt: number | null; rank: string | null; tags: string[];
};

function toMs(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return (v as { seconds: number }).seconds * 1000;
  return null;
}
function mapCust(id: string, d: DocumentData): Cust {
  return {
    id,
    name: (d.name as string) ?? '（無名）',
    totalSales: typeof d.totalSales === 'number' ? d.totalSales : 0,
    visitCount: typeof d.visitCount === 'number' ? d.visitCount : 0,
    lastContactAt: toMs(d.lastContactAt),
    rank: (d.rank as string) ?? null,
    tags: Array.isArray(d.tags) ? (d.tags as string[]).slice(0, 4) : [],
  };
}
async function loadCustomers(uid: string): Promise<Cust[]> {
  const out: Cust[] = [];
  try {
    const snap = await getDocs(collection(db, `personal_customers/${uid}/items`));
    snap.forEach((doc) => out.push(mapCust(doc.id, doc.data())));
  } catch { /* skip */ }
  try {
    const shops = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)));
    for (const shop of shops.docs) {
      try {
        const cs = await getDocs(collection(db, `shop_shops/${shop.id}/customers`));
        cs.forEach((doc) => out.push(mapCust(doc.id, doc.data())));
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return out;
}
const fmtDate = (ms: number | null) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

type Sort = 'sales' | 'recent' | 'visits';

export function CustomersClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [sort, setSort] = useState<Sort>('sales');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    loadCustomers(user.uid).then((c) => { if (alive) { setCusts(c); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user.uid]);

  const list = useMemo(() => {
    let l = custs.filter((c) => !q || c.name.includes(q));
    l = [...l].sort((a, b) =>
      sort === 'sales' ? b.totalSales - a.totalSales :
      sort === 'visits' ? (b.visitCount || 0) - (a.visitCount || 0) :
      (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0)
    );
    return l;
  }, [custs, sort, q]);

  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.10) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li><li>customers</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Customers</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>顧客台帳</h1>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)' }} />実データ {custs.length}
          </div>
        </div>

        {/* controls */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="顧客名で検索"
            aria-label="顧客名で検索"
            style={{ flex: '1 1 200px', minHeight: 40, padding: '8px 14px', borderRadius: 10, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 }}
          />
          <div role="tablist" aria-label="並び替え" style={{ display: 'flex', gap: 6 }}>
            {([['sales', '売上順'], ['recent', '最近順'], ['visits', '来店順']] as [Sort, string][]).map(([k, label]) => {
              const active = sort === k;
              return (
                <button key={k} type="button" role="tab" aria-selected={active} onClick={() => setSort(k)}
                  style={{ appearance: 'none', cursor: 'pointer', minHeight: 40, padding: '7px 14px', borderRadius: 9999, fontSize: 13, fontWeight: active ? 600 : 400, background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: active ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}` }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
        ) : custs.length === 0 ? (
          <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
            <p style={{ margin: '0 0 8px', fontSize: 15 }}>まだ顧客がいません。</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>ネイティブアプリ「YoruLog」で顧客を登録すると、ここに台帳として表示されます。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 12 }}>
            {list.map((c) => (
              <div key={c.id} style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 18, background: 'linear-gradient(135deg,#8B5CF6,#C4384A)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--noxa-font-display-en)', fontSize: 15, flex: 'none' }}>{c.name[0]}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    {c.rank && <div style={{ fontSize: 11, color: 'var(--noxa-accent-primary-ink)', fontFamily: mono }}>{c.rank}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
                  <Stat label="累計売上" value={yen(c.totalSales)} accent />
                  <Stat label="来店" value={`${c.visitCount || 0}`} />
                  <Stat label="最終接触" value={fmtDate(c.lastContactAt)} />
                </div>
                {c.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {c.tags.map((t, i) => <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)' }}>{t}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <p style={{ margin: '16px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
          ※ 実データ集計（noxa-platform）。カルテ詳細・AI 文面・編集はネイティブアプリ「YoruLog」で。
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: mono, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: accent ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{value}</span>
    </div>
  );
}

export default CustomersClient;
