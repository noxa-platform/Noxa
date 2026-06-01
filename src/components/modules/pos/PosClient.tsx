'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { usePosStore, type PosSlip } from '@/lib/pos/store';
import type { CustomerType, OrderItem, BreakdownItem } from '@/lib/pos/engine';

/**
 * ① POS — オーダーエントリー / 伝票計算（実エンジン・実データ）
 *
 * host-club-calculator の伝票計算エンジンを移植し、複数卓 × 複数伝票で運用。
 * 会計（checkout）すると shop_shops/{shopId}/sales に転記され、売上データに加わる。
 * 状態は Firestore（sessions）にリアルタイム保存され、共有タブレット間で同期する。
 * 決済機能は持たない（現金/既存レジ）。POS は伝票計算と売上転記まで。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

const CUSTOMER_TYPES: { id: CustomerType; label: string }[] = [
  { id: 'regular', label: '通常' },
  { id: 'initial', label: '初回' },
  { id: 'r_within', label: 'R内' },
  { id: 'r_after', label: 'R後' },
];

// ─────────────────────────────────────────────

export function PosClient({ user }: { user: User }) {
  const store = usePosStore(user);
  const { config, sessions } = store;

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSlipId, setSelectedSlipId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(config.menuCategories[0]?.id ?? '');
  const [, setTick] = useState(0);

  // 時間ベース料金を反映するため定期再描画
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!activeCategory && config.menuCategories[0]) setActiveCategory(config.menuCategories[0].id);
  }, [config.menuCategories, activeCategory]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.tableId === selectedTableId) ?? null,
    [sessions, selectedTableId],
  );
  const selectedSlip = useMemo(
    () => selectedSession?.slips.find((s) => s.id === selectedSlipId) ?? null,
    [selectedSession, selectedSlipId],
  );

  // 卓を選ぶと最初の伝票を自動選択
  useEffect(() => {
    if (selectedSession && !selectedSlip) {
      setSelectedSlipId(selectedSession.slips[0]?.id ?? null);
    }
  }, [selectedSession, selectedSlip]);

  const result = selectedSlip ? store.resultFor(selectedSlip) : null;

  // ── ローディング / 店舗なし ──
  if (store.loading) {
    return <Shell><div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div></Shell>;
  }
  if (!store.shopId) {
    return (
      <Shell>
        <div style={{ padding: 24, border: '1px solid var(--noxa-border)', borderRadius: 14, background: 'var(--noxa-surface-card)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 15 }}>POS は店舗運営機能です。</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--noxa-text-muted)' }}>
            <Link href="/store/new" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗を登録</Link> すると POS が解放されます。
          </p>
        </div>
      </Shell>
    );
  }

  const menuItemsByName = new Map(config.menuItems.map((m) => [m.name, m]));
  const categoryItems = (config.menuCategories.find((c) => c.id === activeCategory)?.items ?? [])
    .map((name) => menuItemsByName.get(name))
    .filter((m): m is NonNullable<typeof m> => !!m);

  const openSlip = async (tableId: string, tableName: string) => {
    setSelectedTableId(tableId);
    setSelectedSlipId(null); // 追加後、auto-select 効果が新しい伝票（先頭/最新）を選ぶ
    await store.addSlip(tableId, tableName);
  };

  return (
    <Shell device={store.isDevice}>
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_340px]" style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}>
        {/* 左：卓 */}
        <section aria-label="卓選択">
          <PaneTitle>卓</PaneTitle>
          <div className="grid grid-cols-4 lg:grid-cols-2" style={{ gap: 8 }}>
            {config.tableNames.map((name) => {
              const tableId = name;
              const sess = sessions.find((s) => s.tableId === tableId);
              const slipCount = sess?.slips.length ?? 0;
              const occupied = slipCount > 0;
              const total = sess ? sess.slips.reduce((sum, sl) => sum + store.resultFor(sl).currentTotal, 0) : 0;
              const active = tableId === selectedTableId;
              return (
                <button
                  key={tableId}
                  type="button"
                  onClick={() => { setSelectedTableId(tableId); setSelectedSlipId(sess?.slips[0]?.id ?? null); }}
                  aria-pressed={active}
                  style={{
                    appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 62, padding: '9px 10px', borderRadius: 12,
                    background: occupied ? 'var(--noxa-surface-card)' : 'transparent',
                    border: active ? '1px solid var(--noxa-accent-primary)' : `1px solid ${occupied ? 'var(--noxa-border-strong)' : 'var(--noxa-border)'}`,
                    boxShadow: active ? 'var(--noxa-glow-ring)' : 'none',
                    color: 'var(--noxa-text-primary)', display: 'flex', flexDirection: 'column', gap: 4,
                    transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{name}</span>
                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: occupied ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', boxShadow: occupied ? '0 0 8px var(--noxa-accent-primary-ink)' : 'none', flex: 'none' }} />
                  </span>
                  {occupied ? (
                    <span style={{ fontSize: 10, color: 'var(--noxa-text-muted)', fontFamily: mono }}>{slipCount}伝票 · {yen(total)}</span>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>空席</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* 中央：伝票操作 + メニュー */}
        <section aria-label="オーダー" style={{ minWidth: 0 }}>
          {!selectedTableId ? (
            <Empty>左の卓を選択してください。</Empty>
          ) : (
            <>
              {/* 伝票タブ */}
              <PaneTitle>
                {selectedTableId} の伝票
              </PaneTitle>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
                {(selectedSession?.slips ?? []).map((sl) => {
                  const active = sl.id === selectedSlipId;
                  return (
                    <button key={sl.id} type="button" onClick={() => setSelectedSlipId(sl.id)}
                      style={chipStyle(active)}>
                      {sl.name}
                    </button>
                  );
                })}
                <button type="button" onClick={() => openSlip(selectedTableId, selectedTableId)}
                  style={{ ...chipStyle(false), borderStyle: 'dashed', color: 'var(--noxa-accent-primary-ink)', borderColor: 'var(--noxa-border-strong)' }}>
                  ＋ 伝票
                </button>
              </div>

              {!selectedSlip ? (
                <Empty>「＋ 伝票」で新しい伝票を開いてください。</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <SlipControls
                    slip={selectedSlip}
                    initialSetPriceOptions={config.initialSetPriceOptions}
                    onDispatch={(a) => store.dispatchSlip(selectedTableId, selectedSlip.id, a)}
                  />

                  {/* メニュー */}
                  <div>
                    <div role="tablist" aria-label="メニューカテゴリ" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
                      {config.menuCategories.map((c) => {
                        const active = c.id === activeCategory;
                        return (
                          <button key={c.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveCategory(c.id)}
                            style={chipStyle(active)}>
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
                      {categoryItems.map((m) => (
                        <button key={m.name} type="button"
                          onClick={() => store.dispatchSlip(selectedTableId, selectedSlip.id, { type: 'ADD_ORDER', payload: { name: m.name, price: m.price, canHalfOff: m.canHalfOff, isTaxIncluded: m.isTaxIncluded } })}
                          aria-label={`${m.name} ${yen(m.price)} を追加`}
                          style={{
                            appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 70, padding: '11px 13px', borderRadius: 14,
                            background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)',
                            display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
                          }}>
                          <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{m.name}{m.canHalfOff ? <span style={{ color: 'var(--noxa-text-faint)', fontSize: 10, marginLeft: 4 }}>半</span> : null}</span>
                          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--noxa-accent-primary-ink)' }}>{m.isCustom ? '価格入力' : yen(m.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* 右：伝票明細 + 会計 */}
        <section aria-label="会計">
          <PaneTitle>会計</PaneTitle>
          {selectedSlip && result ? (
            <BillPanel
              tableName={selectedTableId ?? ''}
              slip={selectedSlip}
              result={result}
              onDispatch={(a) => selectedTableId && store.dispatchSlip(selectedTableId, selectedSlip.id, a)}
              onRename={(name) => selectedTableId && store.renameSlip(selectedTableId, selectedSlip.id, name)}
              onRemove={() => { if (selectedTableId && window.confirm('この伝票を破棄しますか？（売上に計上されません）')) { store.removeSlip(selectedTableId, selectedSlip.id); setSelectedSlipId(null); } }}
              onCheckout={async (opts) => { if (selectedTableId) { await store.checkoutSlip(selectedTableId, selectedSlip.id, opts); setSelectedSlipId(null); } }}
            />
          ) : (
            <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, color: 'var(--noxa-text-muted)', fontSize: 13 }}>
              伝票を選択すると会計伝票が表示されます。
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

// ───────────────────────── 伝票コントロール（客層・時間・イベント）

function SlipControls({ slip, initialSetPriceOptions, onDispatch }: {
  slip: PosSlip;
  initialSetPriceOptions: number[];
  onDispatch: (a: import('@/lib/pos/engine').Action) => void;
}) {
  const s = slip.state;
  const [showEvents, setShowEvents] = useState(false);
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 客層 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CUSTOMER_TYPES.map((c) => (
          <button key={c.id} type="button" onClick={() => onDispatch({ type: 'SET_CUSTOMER_TYPE', payload: c.id })} style={chipStyle(s.customerType === c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {/* 初回セット価格 */}
      {s.customerType === 'initial' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={miniLabel}>初回セット</span>
          {initialSetPriceOptions.map((p) => (
            <button key={p} type="button" onClick={() => onDispatch({ type: 'SET_INITIAL_SET_PRICE', payload: p })} style={chipStyle(s.initialSetPrice === p)}>
              {yen(p)}
            </button>
          ))}
        </div>
      )}

      {/* 入店時刻 + 同伴 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={miniLabel}>入店</span>
          <input type="time" value={s.entryTime} onChange={(e) => onDispatch({ type: 'SET_ENTRY_TIME', payload: e.target.value })}
            style={{ minHeight: 36, padding: '4px 8px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontFamily: mono, fontSize: 14 }} />
        </label>
        <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_DOHAN' })} style={chipStyle(s.dohan)}>同伴</button>
        <CountStepper label="複数指名" value={s.additionalNominationCount} onChange={(v) => onDispatch({ type: 'SET_ADDITIONAL_NOMINATION_COUNT', payload: v })} />
        <button type="button" onClick={() => setShowEvents((v) => !v)} style={{ ...chipStyle(false), marginLeft: 'auto' }}>
          イベント {showEvents ? '▲' : '▼'}
        </button>
      </div>

      {/* イベント割引 */}
      {showEvents && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_SET_HALF_OFF' })} style={chipStyle(s.isSetHalfOff)}>セット半額</button>
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_GIRLS_PARTY' })} style={chipStyle(s.isGirlsParty)}>女子会</button>
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_APPRECIATION_DAY' })} style={chipStyle(s.isAppreciationDay)}>感謝DAY</button>
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_SEVEN_LUCK' })} style={chipStyle(s.isSevenLuck)}>セブンラック</button>
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_GOLD_TICKET' })} style={chipStyle(s.isGoldTicket)}>ゴールド</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 会計パネル

function BillPanel({ tableName, slip, result, onDispatch, onRename, onRemove, onCheckout }: {
  tableName: string;
  slip: PosSlip;
  result: import('@/lib/pos/engine').CalculationResult;
  onDispatch: (a: import('@/lib/pos/engine').Action) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onCheckout: (opts: { amount: number; castName?: string; customerName?: string; guests?: number }) => Promise<void>;
}) {
  const activeOrders = slip.state.orders.filter((o) => o.count > 0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [amount, setAmount] = useState<number>(result.currentTotal);
  const [castName, setCastName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [guests, setGuests] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setAmount(result.currentTotal); }, [result.currentTotal]);

  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--noxa-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 17, fontWeight: 500 }}>{tableName}</span>
          <input value={slip.name} onChange={(e) => onRename(e.target.value)} aria-label="伝票名"
            style={{ width: 64, minHeight: 30, padding: '2px 6px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 13 }} />
        </div>
        {result.isOutOfHours && <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-status-warning)' }}>営業時間外</span>}
      </div>

      {/* 明細（数量操作） */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
        {activeOrders.length === 0 && <li style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>オーダー未入力</li>}
        {activeOrders.map((o) => (
          <OrderRow key={o.id} order={o} onDispatch={onDispatch} />
        ))}
      </ul>

      {/* 内訳 */}
      <div style={{ borderTop: '1px solid var(--noxa-divider)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {result.breakdown.filter((b) => b.amount !== 0 || b.isTotal).map((b, i) => (
          <BreakdownRow key={i} item={b} />
        ))}
      </div>

      {/* 合計 */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--noxa-border-strong)' }}>
        <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)' }}>現在合計</span>
        <span className="noxa-display" style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 30, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{yen(result.currentTotal)}</span>
      </div>

      {/* 会計フォーム */}
      {!checkingOut ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" onClick={() => setCheckingOut(true)} className="noxa-btn noxa-btn-primary"
            style={primaryBtn} disabled={activeOrders.length === 0 && result.currentTotal === 0}>
            会計する → 売上へ計上
          </button>
          <button type="button" onClick={onRemove} className="noxa-btn noxa-btn-ghost"
            style={ghostBtn}>伝票を破棄</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={miniLabel}>確定金額</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))}
              style={fieldStyle} inputMode="numeric" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <span style={miniLabel}>顧客名（任意）</span>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 76 }}>
              <span style={miniLabel}>人数</span>
              <input type="number" value={guests} min={1} onChange={(e) => setGuests(Math.max(1, Number(e.target.value)))} style={fieldStyle} inputMode="numeric" />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={miniLabel}>担当キャスト（任意）</span>
            <input value={castName} onChange={(e) => setCastName(e.target.value)} style={fieldStyle} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.7 : 1 }}
              onClick={async () => {
                setBusy(true);
                try { await onCheckout({ amount, castName: castName || undefined, customerName: customerName || undefined, guests }); }
                finally { setBusy(false); setCheckingOut(false); }
              }}>
              {busy ? '計上中…' : `${yen(amount)} で確定`}
            </button>
            <button type="button" onClick={() => setCheckingOut(false)} className="noxa-btn noxa-btn-ghost" style={{ ...ghostBtn, width: 80 }}>戻る</button>
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 10, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>
        ※ 決済は既存レジ運用。会計確定で売上データ（②）へ転記されます。
      </p>
    </div>
  );
}

function OrderRow({ order, onDispatch }: { order: OrderItem; onDispatch: (a: import('@/lib/pos/engine').Action) => void }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: order.isHalfOff ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)' }}>{order.name}</span>
        <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-text-faint)' }}>{yen(order.price)} / 点</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {order.canHalfOff && (
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_ORDER_HALF_OFF', payload: order.id })} title="半額切替"
            style={{ ...stepBtn, width: 26, color: order.isHalfOff ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)', borderColor: order.isHalfOff ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)' }}>半</button>
        )}
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

function CountStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={miniLabel}>{label}</span>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} style={stepBtn}>−</button>
      <span style={{ fontFamily: mono, minWidth: 18, textAlign: 'center' }}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} style={stepBtn}>＋</button>
    </span>
  );
}

// ───────────────────────── レイアウト・共通スタイル

function Shell({ children, device }: { children: React.ReactNode; device?: boolean }) {
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li>
            <li aria-hidden>·</li>
            <li>pos</li>
          </ol>
        </nav>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>Noxa OS · Module 01 · Order Entry</div>
            <h1 className="noxa-display" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--noxa-font-display-en)', fontStyle: 'italic', color: 'var(--noxa-accent-primary-ink)', fontWeight: 400 }}>№ 01</span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>POS · オーダー</span>
            </h1>
          </div>
          <div role="note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)', boxShadow: '0 0 8px var(--noxa-status-success)' }} />
            {device ? '店舗端末 · 実データ' : '実データ · 伝票→売上'}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PaneTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="noxa-eyebrow" style={{ fontSize: 11, marginBottom: 12, display: 'block' }}>{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 20, color: 'var(--noxa-text-muted)', fontSize: 13 }}>{children}</div>;
}

const miniLabel: React.CSSProperties = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--noxa-text-faint)' };

function chipStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', minHeight: 34, padding: '6px 14px', borderRadius: 9999,
    fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: active ? 600 : 400,
    background: active ? 'var(--noxa-accent-primary)' : 'var(--noxa-surface-card)',
    color: active ? '#fff' : 'var(--noxa-text-muted)',
    border: `1px solid ${active ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)'}`,
    boxShadow: active ? 'var(--noxa-glow-soft)' : 'none',
    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
  };
}

const stepBtn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, flex: 'none',
  background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)',
  fontSize: 15, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const fieldStyle: React.CSSProperties = {
  width: '100%', minHeight: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)',
  border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16,
};

const primaryBtn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', width: '100%', minHeight: 46, borderRadius: 12,
  border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff',
  fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)',
};

const ghostBtn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', width: '100%', minHeight: 40, borderRadius: 12,
  border: '1px solid var(--noxa-border-strong)', background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)',
  fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: 500,
};

export default PosClient;
