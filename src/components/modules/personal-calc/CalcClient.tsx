'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import type { StoreConfig } from '@/lib/pos/types';
import { createDefaultStoreConfig } from '@/lib/pos/defaultConfig';
import {
  calculatorReducer, calculateResult, createInitialState,
  type Action, type CalculatorState, type CustomerType, type OrderItem, type BreakdownItem,
} from '@/lib/pos/engine';

/**
 * 伝票計算（個人機能）— 所属店舗の料金設定で「1卓ぶんの伝票」を計算する。
 * host-club-calculator 同等の単一伝票計算機。会計記録は残さない（自分用の計算）。
 * 店舗の pos_config（料金/メニュー/半額ルール）を読み込む。複数所属は選択可。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const CUSTOMER_TYPES: { id: CustomerType; label: string }[] = [
  { id: 'regular', label: '通常' }, { id: 'initial', label: '初回' }, { id: 'r_within', label: 'R内' }, { id: 'r_after', label: 'R後' },
];

type ShopRef = { id: string; name: string };

// 所属店舗を集める（owner shop ＋ memberships 逆引き）
async function loadShops(uid: string): Promise<ShopRef[]> {
  const map = new Map<string, string>();
  try {
    const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)));
    owned.forEach((d) => map.set(d.id, (d.data().name as string) ?? d.id));
  } catch { /* skip */ }
  try {
    const ms = await getDocs(collection(db, `account_users/${uid}/memberships`));
    ms.forEach((d) => { const x = d.data(); map.set(d.id, (x.shopName as string) ?? d.id); });
  } catch { /* skip */ }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

export function CalcClient({ user }: { user: User }) {
  const [shops, setShops] = useState<ShopRef[]>([]);
  const [shopId, setShopId] = useState<string | null>(null);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<CalculatorState>(() => createInitialState(createDefaultStoreConfig()));
  const [activeCategory, setActiveCategory] = useState('');
  const [customItem, setCustomItem] = useState<{ name: string } | null>(null);
  const [, setTick] = useState(0);
  const configRef = useRef<StoreConfig>(createDefaultStoreConfig());

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let alive = true;
    loadShops(user.uid).then((s) => {
      if (!alive) return;
      setShops(s);
      setShopId(s[0]?.id ?? null);
      if (s.length === 0) setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user.uid]);

  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      let cfg = createDefaultStoreConfig('active');
      try {
        const snap = await getDoc(doc(db, `shop_shops/${shopId}/pos_config/active`));
        if (snap.exists()) cfg = { ...createDefaultStoreConfig('active'), ...(snap.data() as Partial<StoreConfig>) } as StoreConfig;
      } catch { /* default */ }
      if (!alive) return;
      configRef.current = cfg;
      setConfig(cfg);
      setState(createInitialState(cfg));
      setActiveCategory(cfg.menuCategories[0]?.id ?? '');
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [shopId]);

  const dispatch = useCallback((a: Action) => setState((prev) => calculatorReducer(prev, a, configRef.current)), []);

  const result = useMemo(
    () => config ? calculateResult({ ...state, currentTime: state.isDebugMode ? state.currentTime : nowHHMM() }, config) : null,
    [state, config],
  );

  if (loading) return <Shell><div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div></Shell>;
  if (shops.length === 0 || !config) {
    return (
      <Shell>
        <Empty>
          <p style={{ margin: '0 0 8px' }}>所属している店舗が見つかりません。</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>店舗に所属するか、<Link href="/store/new" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗を登録</Link> すると、その料金設定で伝票計算ができます。</p>
        </Empty>
      </Shell>
    );
  }

  const menuItemsByName = new Map(config.menuItems.map((m) => [m.name, m]));
  const categoryItems = (config.menuCategories.find((c) => c.id === activeCategory)?.items ?? [])
    .map((n) => menuItemsByName.get(n)).filter((m): m is NonNullable<typeof m> => !!m);
  const activeOrders = state.orders.filter((o) => o.count > 0);

  const addItem = (m: { name: string; price: number; canHalfOff?: boolean; isTaxIncluded?: boolean; isCustom?: boolean }) => {
    if (m.isCustom) { setCustomItem({ name: m.name }); return; }
    dispatch({ type: 'ADD_ORDER', payload: { name: m.name, price: m.price, canHalfOff: m.canHalfOff, isTaxIncluded: m.isTaxIncluded } });
  };

  return (
    <Shell>
      {shops.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={miniLabel}>店舗</span>
          {shops.map((s) => <button key={s.id} type="button" onClick={() => setShopId(s.id)} style={chipStyle(s.id === shopId)}>{s.name}</button>)}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px]" style={{ gap: 'clamp(12px,1.6vw,18px)', alignItems: 'start' }}>
        {/* 左：入力 */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 客層・時間・イベント */}
          <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CUSTOMER_TYPES.map((c) => <button key={c.id} type="button" onClick={() => dispatch({ type: 'SET_CUSTOMER_TYPE', payload: c.id })} style={chipStyle(state.customerType === c.id)}>{c.label}</button>)}
            </div>
            {state.customerType === 'initial' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={miniLabel}>初回セット</span>
                {config.initialSetPriceOptions.map((p) => <button key={p} type="button" onClick={() => dispatch({ type: 'SET_INITIAL_SET_PRICE', payload: p })} style={chipStyle(state.initialSetPrice === p)}>{yen(p)}</button>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={miniLabel}>入店</span>
                <input type="time" value={state.entryTime} onChange={(e) => dispatch({ type: 'SET_ENTRY_TIME', payload: e.target.value })} style={{ minHeight: 36, padding: '4px 8px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontFamily: mono, fontSize: 14 }} />
              </label>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_DOHAN' })} style={chipStyle(state.dohan)}>同伴</button>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={miniLabel}>複数指名</span>
                <button type="button" onClick={() => dispatch({ type: 'SET_ADDITIONAL_NOMINATION_COUNT', payload: Math.max(0, state.additionalNominationCount - 1) })} style={stepBtn}>−</button>
                <span style={{ fontFamily: mono, minWidth: 18, textAlign: 'center' }}>{state.additionalNominationCount}</span>
                <button type="button" onClick={() => dispatch({ type: 'SET_ADDITIONAL_NOMINATION_COUNT', payload: state.additionalNominationCount + 1 })} style={stepBtn}>＋</button>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_SET_HALF_OFF' })} style={chipStyle(state.isSetHalfOff)}>セット半額</button>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_GIRLS_PARTY' })} style={chipStyle(state.isGirlsParty)}>女子会</button>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_APPRECIATION_DAY' })} style={chipStyle(state.isAppreciationDay)}>感謝DAY</button>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_SEVEN_LUCK' })} style={chipStyle(state.isSevenLuck)}>セブンラック</button>
              <button type="button" onClick={() => dispatch({ type: 'TOGGLE_GOLD_TICKET' })} style={chipStyle(state.isGoldTicket)}>ゴールド</button>
              <button type="button" onClick={() => dispatch({ type: 'RESET' })} style={{ ...chipStyle(false), marginLeft: 'auto', color: 'var(--noxa-status-error)', borderColor: 'rgba(229,115,115,0.4)' }}>クリア</button>
            </div>
          </div>

          {/* クイック */}
          {config.pinnedOrders.length > 0 && (
            <div>
              <div style={{ ...miniLabel, marginBottom: 6 }}>クイック</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {config.pinnedOrders.map((p) => (
                  <button key={p.name} type="button" onClick={() => dispatch({ type: 'ADD_ORDER', payload: { name: p.name, price: p.price, canHalfOff: p.canHalfOff } })} style={{ ...chipStyle(false), borderColor: 'var(--noxa-border-strong)' }}>
                    {p.name}<span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-accent-primary-ink)', marginLeft: 6 }}>{yen(p.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* メニュー */}
          <div>
            <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
              {config.menuCategories.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === activeCategory} onClick={() => setActiveCategory(c.id)} style={chipStyle(c.id === activeCategory)}>{c.label}</button>)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
              {categoryItems.map((m) => (
                <button key={m.name} type="button" onClick={() => addItem(m)} style={{ appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 70, padding: '11px 13px', borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{m.name}{m.canHalfOff ? <span style={{ color: 'var(--noxa-text-faint)', fontSize: 10, marginLeft: 4 }}>半</span> : null}</span>
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--noxa-accent-primary-ink)' }}>{m.isCustom ? '金額入力' : yen(m.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右：伝票 + 時間別スケジュール */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {activeOrders.length === 0 && <li style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>オーダー未入力</li>}
                {activeOrders.map((o) => <OrderRow key={o.id} order={o} onDispatch={dispatch} />)}
              </ul>
              <div style={{ borderTop: '1px solid var(--noxa-divider)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.breakdown.filter((b) => b.amount !== 0 || b.isTotal).map((b, i) => <BreakdownRow key={i} item={b} />)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--noxa-border-strong)' }}>
                <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)' }}>現在合計</span>
                <span className="noxa-display" style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 30, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{yen(result.currentTotal)}</span>
              </div>
              {result.isOutOfHours && <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-status-warning)' }}>営業時間外（入店+1時間で計算）</span>}
            </div>

            {/* 時間別スケジュール */}
            <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16 }}>
              <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 10 }}>時間別 料金（{state.entryTime} 入店）</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.schedule.map((it, i) => (
                  <li key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ fontFamily: mono, color: 'var(--noxa-text-muted)' }}>〜{it.timeLimit}</span>
                    <span style={{ fontFamily: mono, fontVariantNumeric: 'tabular-nums' }}>{yen(it.totalPrice)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {customItem && (
        <CustomPriceDialog name={customItem.name} onClose={() => setCustomItem(null)}
          onAdd={(name, price) => { dispatch({ type: 'ADD_ORDER', payload: { name, price } }); setCustomItem(null); }} />
      )}
    </Shell>
  );
}

function OrderRow({ order, onDispatch }: { order: OrderItem; onDispatch: (a: Action) => void }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: order.isHalfOff ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{order.name}</span>
        <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{yen(order.price)} / 点</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {order.canHalfOff && <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_ORDER_HALF_OFF', payload: order.id })} title="半額" style={{ ...stepBtn, width: 26, color: order.isHalfOff ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)' }}>半</button>}
        <button type="button" onClick={() => onDispatch({ type: 'UPDATE_ORDER_COUNT', payload: { id: order.id, delta: -1 } })} style={stepBtn}>−</button>
        <span style={{ fontFamily: mono, minWidth: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{order.count}</span>
        <button type="button" onClick={() => onDispatch({ type: 'UPDATE_ORDER_COUNT', payload: { id: order.id, delta: 1 } })} style={stepBtn}>＋</button>
      </span>
    </li>
  );
}
function BreakdownRow({ item }: { item: BreakdownItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: item.isTotal ? 13 : 12 }}>
      <span style={{ color: item.isTotal ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)', fontWeight: item.isTotal ? 600 : 400 }}>{item.label}</span>
      <span style={{ fontFamily: mono, fontVariantNumeric: 'tabular-nums', color: item.isTotal ? 'var(--noxa-text-primary)' : 'var(--noxa-text-muted)' }}>{yen(item.amount)}</span>
    </div>
  );
}
function CustomPriceDialog({ name, onClose, onAdd }: { name: string; onClose: () => void; onAdd: (name: string, price: number) => void }) {
  const [label, setLabel] = useState(name === 'オリシャン / その他' ? '' : name);
  const [price, setPrice] = useState(0);
  return (
    <div role="dialog" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(360px,92vw)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="noxa-eyebrow" style={{ fontSize: 11 }}>{name} · 金額入力</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={miniLabel}>品名</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：オリジナルシャンパン" style={fieldStyle} autoFocus /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={miniLabel}>金額（税抜）</span>
          <input type="number" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))} inputMode="numeric" style={fieldStyle} /></label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1 }} disabled={price <= 0 || !label.trim()} onClick={() => onAdd(label.trim(), price)}>追加</button>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, width: 80 }}>戻る</button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139,92,246,0.10) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li><li aria-hidden>·</li><li>calc</li>
          </ol>
        </nav>
        <div style={{ marginBottom: 18 }}>
          <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · 個人機能 · 伝票計算</div>
          <h1 className="noxa-display" style={{ fontSize: 'clamp(24px, 4vw, 34px)', margin: 0, fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>伝票計算</h1>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--noxa-text-muted)' }}>所属店舗の料金設定で 1 卓ぶんを試算（記録は残りません）。</p>
        </div>
        {children}
      </div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 24, color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</div>;
}

const miniLabel: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' };
function chipStyle(active: boolean): React.CSSProperties {
  return { appearance: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', minHeight: 34, padding: '6px 14px', borderRadius: 9999, fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: active ? 600 : 400, background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)', color: active ? '#fff' : 'var(--noxa-text-muted)', border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`, boxShadow: active ? 'var(--noxa-glow-soft)' : 'none' };
}
const stepBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, flex: 'none', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 15, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const fieldStyle: React.CSSProperties = { width: '100%', minHeight: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 };
const primaryBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', width: '100%', minHeight: 46, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' };
const ghostBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', minHeight: 40, borderRadius: 12, border: '1px solid var(--noxa-border-strong)', background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)', fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: 500 };

export default CalcClient;
