'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { voidSale, editSale } from '@/lib/sales';
import type { User } from 'firebase/auth';

/**
 * ② 売上管理 — Noxa OS モジュール（実データ）
 *
 * yorulog/native アプリと同じ Firestore(noxa-platform) を読み、顧客の
 * 非正規化フィールド totalSales を集計して実売上を表示する。
 * - personal_customers/{uid}/items（MyDeck / 個人モード）
 * - 自分が owner の shop_shops/{shopId}/customers（店舗モード）
 * 詳細な顧客カルテ・AI 文面・ログ入力はネイティブアプリ「YoruLog」で。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

type Cust = {
  id: string;
  name: string;
  totalSales: number;
  visitCount: number;
  lastContactAt: number | null; // ms
  rank: string | null;
};

function toMs(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) {
    return (v as { seconds: number }).seconds * 1000;
  }
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
  };
}

const fmtDate = (ms: number | null) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// 営業日キー（6時より前は前日扱い。POS の checkout と一致）
function todayKey(): string {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type PosSalesSummary = { total: number; today: number; count: number; todayCount: number };
type Mode = 'owner' | 'cast' | 'personal';
type PosSale = {
  id: string; shopId: string; amount: number; tableName: string; slipName: string;
  castName: string | null; customerName: string | null; checkoutAtMs: number | null; dayKey: string;
  voided: boolean; voidReason: string;
};

/**
 * ロール対応の読み込み:
 *  - owner（店舗オーナー）: 店舗全体の顧客・売上を集計
 *  - cast（所属メンバー）: 自分が担当の顧客（mainCastUid==uid）・自分の売上（castUid==uid）だけ
 *  - personal: MyDeck のみ
 */
async function loadAll(uid: string): Promise<{ mode: Mode; custs: Cust[]; pos: PosSalesSummary; sales: PosSale[] }> {
  const tk = todayKey();
  const pos: PosSalesSummary = { total: 0, today: 0, count: 0, todayCount: 0 };
  const custs: Cust[] = [];
  const sales: PosSale[] = [];
  const addSale = (shopId: string, id: string, d: DocumentData) => {
    const a = typeof d.amount === 'number' ? d.amount : 0;
    const voided = d.voided === true;
    sales.push({
      id, shopId, amount: a, tableName: (d.tableName as string) ?? '', slipName: (d.slipName as string) ?? '',
      castName: (d.castName as string) ?? null, customerName: (d.customerName as string) ?? null,
      checkoutAtMs: toMs(d.checkoutAt), dayKey: (d.dayKey as string) ?? '', voided, voidReason: (d.voidReason as string) ?? '',
    });
    if (voided) return; // 取消は集計から除外
    pos.total += a; pos.count += 1;
    if (d.dayKey === tk) { pos.today += a; pos.todayCount += 1; }
  };
  const addMyDeck = async () => {
    try { const snap = await getDocs(collection(db, `personal_customers/${uid}/items`)); snap.forEach((d) => custs.push(mapCust(d.id, d.data()))); } catch { /* skip */ }
  };

  // owner shops
  let ownerShops: { id: string }[] = [];
  try { const s = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid))); ownerShops = s.docs.map((d) => ({ id: d.id })); } catch { /* skip */ }
  if (ownerShops.length > 0) {
    for (const shop of ownerShops) {
      try { const cs = await getDocs(collection(db, `shop_shops/${shop.id}/customers`)); cs.forEach((d) => custs.push(mapCust(d.id, d.data()))); } catch { /* skip */ }
      try { const ss = await getDocs(collection(db, `shop_shops/${shop.id}/sales`)); ss.forEach((d) => addSale(shop.id, d.id, d.data())); } catch { /* skip */ }
    }
    await addMyDeck();
    return { mode: 'owner', custs, pos, sales };
  }

  // member shops（キャスト）
  let memberShopIds: string[] = [];
  try { const ms = await getDocs(collection(db, `account_users/${uid}/memberships`)); memberShopIds = ms.docs.map((d) => d.id); } catch { /* skip */ }
  if (memberShopIds.length > 0) {
    for (const shopId of memberShopIds) {
      try { const cs = await getDocs(query(collection(db, `shop_shops/${shopId}/customers`), where('mainCastUid', '==', uid))); cs.forEach((d) => custs.push(mapCust(d.id, d.data()))); } catch { /* skip */ }
      try { const ss = await getDocs(query(collection(db, `shop_shops/${shopId}/sales`), where('castUid', '==', uid))); ss.forEach((d) => addSale(shopId, d.id, d.data())); } catch { /* skip */ }
    }
    await addMyDeck();
    return { mode: 'cast', custs, pos, sales };
  }

  await addMyDeck();
  return { mode: 'personal', custs, pos, sales };
}

export function SalesClient({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [pos, setPos] = useState<PosSalesSummary>({ total: 0, today: 0, count: 0, todayCount: 0 });
  const [sales, setSales] = useState<PosSale[]>([]);
  const [mode, setMode] = useState<Mode>('personal');
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    loadAll(user.uid)
      .then((r) => { setCusts(r.custs); setPos(r.pos); setSales(r.sales); setMode(r.mode); setLoading(false); })
      .catch((e) => { setErr(String(e?.message ?? e)); setLoading(false); });
  };
  useEffect(() => { reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [user.uid]);

  const doVoid = async (s: PosSale) => {
    const reason = window.prompt('取消理由（任意）'); if (reason === null) return;
    await voidSale(s.shopId, s.id, reason, user.uid); reload();
  };
  const doEdit = async (s: PosSale) => {
    const v = window.prompt('修正後の金額（円）', String(s.amount)); if (v === null) return;
    const amount = Number(v); if (!Number.isFinite(amount) || amount < 0) return;
    await editSale(s.shopId, s.id, { amount }, user.uid); reload();
  };
  const recentSales = [...sales].sort((a, b) => (b.checkoutAtMs ?? 0) - (a.checkoutAtMs ?? 0)).slice(0, 30);

  const total = custs.reduce((s, c) => s + c.totalSales, 0);
  const count = custs.length;
  const avg = count > 0 ? total / count : 0;
  const visits = custs.reduce((s, c) => s + (c.visitCount || 0), 0);
  const ranking = [...custs].filter((c) => c.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales).slice(0, 8);
  const recent = [...custs].filter((c) => c.lastContactAt).sort((a, b) => (b.lastContactAt ?? 0) - (a.lastContactAt ?? 0)).slice(0, 6);
  const maxRank = ranking.length > 0 ? ranking[0].totalSales : 1;

  return (
    <div
      style={{
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(103,232,249,0.08) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        {/* header */}
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li>
            <li aria-hidden>·</li>
            <li>sales</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Module 02 · Sales</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontStyle: 'italic', color: 'var(--noxa-accent-primary-ink)', fontWeight: 400 }}>№ 02</span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>{mode === 'cast' ? 'マイ売上' : '売上管理'}</span>
            </h1>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)', boxShadow: '0 0 8px var(--noxa-status-success)' }} />
            実データ
          </div>
        </div>

        {/* POS 実会計（会計確定でここに加算される） */}
        {pos.count > 0 && (
          <section aria-label="POS実会計" style={{ marginBottom: 20 }}>
            <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12 }}>POS 実会計（伝票→売上）</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12 }}>
              <Kpi label="本日売上" value={yen(pos.today)} accent />
              <Kpi label="本日会計数" value={`${pos.todayCount} 件`} />
              <Kpi label="累計売上(POS)" value={yen(pos.total)} />
              <Kpi label="累計会計数" value={`${pos.count} 件`} />
            </div>
          </section>
        )}

        {/* 会計履歴（取消/修正） */}
        {recentSales.length > 0 && (
          <section aria-label="会計履歴" style={{ marginBottom: 20 }}>
            <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12 }}>会計履歴（取消・修正）</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentSales.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', opacity: s.voided ? 0.55 : 1 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', minWidth: 92 }}>{s.checkoutAtMs ? new Date(s.checkoutAtMs).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                  <span style={{ fontSize: 12, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.tableName && <b>{s.tableName}</b>} {s.customerName && <span>· {s.customerName}</span>} {s.castName && <span style={{ color: 'var(--noxa-text-muted)' }}>/ {s.castName}</span>}
                    {s.voided && <span style={{ color: 'var(--noxa-status-error)', marginLeft: 8, fontSize: 11 }}>取消{s.voidReason ? `（${s.voidReason}）` : ''}</span>}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 13, fontVariantNumeric: 'tabular-nums', textDecoration: s.voided ? 'line-through' : 'none' }}>{yen(s.amount)}</span>
                  {!s.voided && (
                    <>
                      <button type="button" onClick={() => doEdit(s)} style={histBtn}>修正</button>
                      <button type="button" onClick={() => doVoid(s)} style={{ ...histBtn, color: 'var(--noxa-status-error)' }}>取消</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--noxa-text-faint)' }}>取消は削除せず無効化し集計から除外（監査ログ保持）。修正は金額を訂正します。</p>
          </section>
        )}

        {loading ? (
          <div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div>
        ) : err ? (
          <div style={{ padding: 16, border: '1px solid var(--noxa-border)', borderRadius: 12, color: 'var(--noxa-status-warning)', fontSize: 13 }}>
            データ取得に失敗しました：{err}
          </div>
        ) : count === 0 ? (
          <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
            <p style={{ margin: '0 0 8px', fontSize: 15 }}>まだ顧客データがありません。</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>
              ネイティブアプリ「YoruLog」で顧客・売上を登録すると、ここに実データが集計されます。
            </p>
          </div>
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12, marginBottom: 20 }}>
              <Kpi label="累計売上" value={yen(total)} accent />
              <Kpi label="顧客数" value={`${count} 名`} />
              <Kpi label="平均売上 / 客" value={yen(avg)} />
              <Kpi label="累計来店" value={`${visits} 回`} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 16 }}>
              {/* ranking */}
              <section aria-label="売上ランキング" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 18 }}>
                <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 14 }}>売上ランキング（顧客別）</h2>
                {ranking.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)' }}>売上が記録された顧客はまだありません。</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {ranking.map((c, i) => (
                      <li key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13 }}>
                            <span style={{ fontFamily: mono, color: 'var(--noxa-text-faint)', marginRight: 8 }}>{i + 1}</span>
                            {c.name}{c.rank ? <span style={{ color: 'var(--noxa-text-faint)', fontSize: 11, marginLeft: 6 }}>{c.rank}</span> : null}
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{yen(c.totalSales)}</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--noxa-surface-muted)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${(c.totalSales / maxRank) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--noxa-accent-primary), var(--noxa-accent-primary-neon))' }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* recent */}
              <section aria-label="最近の接触" style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 18 }}>
                <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 14 }}>最近の接触</h2>
                {recent.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--noxa-text-muted)' }}>接触記録はまだありません。</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {recent.map((c) => (
                      <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--noxa-divider)', fontSize: 13 }}>
                        <span>{c.name}</span>
                        <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                          <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-muted)' }}>来店 {c.visitCount}</span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--noxa-text-faint)', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(c.lastContactAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <p style={{ margin: '16px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
              ※ 実データ（noxa-platform Firestore）を集計。詳細な顧客カルテ・AI 文面・ログ入力はネイティブアプリ「YoruLog」で。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const histBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 11, cursor: 'pointer', flex: 'none' };

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: accent ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{value}</span>
    </div>
  );
}

export default SalesClient;
