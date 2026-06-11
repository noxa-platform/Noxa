'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { usePosStore, type ShopCustomer } from '@/lib/pos/store';
import { useShopConfig } from '@/lib/shopConfig';
import type { CustomerType, OrderItem, BreakdownItem, PosSlip, Action, CalculationResult } from '@/lib/pos/engine';
import type { FloorTable, Cast } from '@/lib/seating/types';

/**
 * ① POS — オーダーエントリー / 伝票計算（実エンジン・実データ・席回しと卓統合）
 *
 * 卓は seating_tables（席回しと同一ドキュメント）。伝票(slips)を同じ卓に持たせるため
 * 席回しのキャスト配置・開卓/退店と完全同期する。会計で sales に転記。
 */

const mono = 'var(--noxa-font-mono)';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

const CUSTOMER_TYPES: { id: CustomerType; label: string }[] = [
  { id: 'regular', label: '通常' },
  { id: 'initial', label: '初回' },
  { id: 'r_within', label: 'R内' },
  { id: 'r_after', label: 'R後' },
];

export function PosClient({ user, focusTableId, embedded }: { user: User; focusTableId?: string; embedded?: boolean }) {
  const store = usePosStore(user);
  const { config, tables, casts } = store;
  const checkoutLabel = useShopConfig(user).t('checkout');

  const [selectedTableId, setSelectedTableId] = useState<string | null>(focusTableId ?? null);
  const [selectedSlipId, setSelectedSlipId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(config.menuCategories[0]?.id ?? '');
  const [customItem, setCustomItem] = useState<{ name: string } | null>(null);
  const [newSlipFor, setNewSlipFor] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!activeCategory && config.menuCategories[0]) setActiveCategory(config.menuCategories[0].id); }, [config.menuCategories, activeCategory]);

  const castById = useMemo(() => new Map(casts.map((c) => [c.id, c.name])), [casts]);
  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;
  const slips = selectedTable?.slips ?? [];
  const selectedSlip = slips.find((s) => s.id === selectedSlipId) ?? null;

  useEffect(() => {
    if (selectedTable && !selectedSlip) setSelectedSlipId(slips[0]?.id ?? null);
  }, [selectedTable, selectedSlip, slips]);

  const result = selectedSlip ? store.resultFor(selectedSlip) : null;

  if (store.loading) return <Shell embedded={embedded}><div className="noxa-eyebrow" style={{ padding: '40px 0' }}>読み込み中…</div></Shell>;
  if (!store.shopId) {
    return (
      <Shell embedded={embedded}>
        <Empty>POS は店舗運営機能です。<Link href="/store/new" style={{ color: 'var(--noxa-accent-primary-ink)' }}>店舗を登録</Link> すると解放されます。</Empty>
      </Shell>
    );
  }
  if (store.needsSeed) {
    return (
      <Shell device={store.isDevice} embedded={embedded}>
        <Empty>
          <p style={{ margin: '0 0 12px' }}>フロアの卓が未設定です（POS と席回しで共有）。</p>
          {store.canConfig
            ? <button type="button" className="noxa-btn noxa-btn-primary" style={primaryBtn} onClick={() => store.seedTables()}>卓を初期作成する</button>
            : <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>オーナーが卓を作成すると表示されます。</span>}
        </Empty>
      </Shell>
    );
  }

  const menuItemsByName = new Map(config.menuItems.map((m) => [m.name, m]));
  const categoryItems = (config.menuCategories.find((c) => c.id === activeCategory)?.items ?? [])
    .map((name) => menuItemsByName.get(name)).filter((m): m is NonNullable<typeof m> => !!m);

  const addItem = (m: { name: string; price: number; canHalfOff?: boolean; isTaxIncluded?: boolean; isCustom?: boolean }) => {
    if (!selectedTableId || !selectedSlip) return;
    if (m.isCustom) { setCustomItem({ name: m.name }); return; }
    store.dispatchSlip(selectedTableId, selectedSlip.id, { type: 'ADD_ORDER', payload: { name: m.name, price: m.price, canHalfOff: m.canHalfOff, isTaxIncluded: m.isTaxIncluded } });
  };

  const createSlip = async (tableId: string, init: { castName?: string; castUid?: string; castId?: string; customerName?: string; customerId?: string; customerType?: CustomerType }) => {
    setSelectedTableId(tableId);
    setSelectedSlipId(null);
    setNewSlipFor(null);
    try {
      await store.addSlip(tableId, init);
    } catch (e) {
      console.error('[POS] addSlip failed', e);
      window.alert('伝票の作成に失敗しました: ' + ((e as Error)?.message ?? String(e)));
    }
  };

  return (
    <Shell device={store.isDevice} configurable={store.canConfig} embedded={embedded}>
      <div className={embedded ? 'grid grid-cols-1 lg:grid-cols-[1fr_340px]' : 'grid grid-cols-1 lg:grid-cols-[200px_1fr_340px]'} style={{ gap: 'clamp(12px, 1.6vw, 18px)', alignItems: 'start' }}>
        {/* 左：卓（席回しと共有）。埋め込み（席回しから単一卓）では非表示 */}
        {!embedded && (
        <section aria-label="卓選択">
          <PaneTitle>卓 <span style={{ color: 'var(--noxa-text-faint)', fontWeight: 400 }}>（席回しと同期）</span></PaneTitle>
          <div className="grid grid-cols-4 lg:grid-cols-2" style={{ gap: 8 }}>
            {tables.map((t) => {
              const tslips = t.slips ?? [];
              const occupied = tslips.length > 0 || t.status !== 'EMPTY' || (t.currentHostIds?.length ?? 0) > 0;
              const total = tslips.reduce((sum, sl) => sum + store.resultFor(sl).currentTotal, 0);
              const active = t.id === selectedTableId;
              return (
                <button key={t.id} type="button"
                  onClick={() => { setSelectedTableId(t.id); setSelectedSlipId(t.slips?.[0]?.id ?? null); }}
                  aria-pressed={active}
                  style={{
                    appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 64, padding: '9px 10px', borderRadius: 12,
                    background: occupied ? 'var(--noxa-surface-card)' : 'transparent',
                    border: active ? '1px solid var(--noxa-accent-primary)' : `1px solid ${occupied ? 'var(--noxa-border-strong)' : 'var(--noxa-border)'}`,
                    boxShadow: active ? 'var(--noxa-glow-ring)' : 'none', color: 'var(--noxa-text-primary)',
                    display: 'flex', flexDirection: 'column', gap: 4, transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                    <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: occupied ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-faint)', boxShadow: occupied ? '0 0 8px var(--noxa-accent-primary-ink)' : 'none' }} />
                  </span>
                  {occupied ? (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--noxa-text-muted)', fontFamily: mono }}>{tslips.length}伝票 · {yen(total)}</span>
                      {(t.currentHostIds?.length ?? 0) > 0 && (
                        <span style={{ fontSize: 9, color: 'var(--noxa-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.currentHostIds.map((cid) => castById.get(cid) ?? '?').join(' ')}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--noxa-text-faint)', fontFamily: mono }}>空席</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
        )}

        {/* 中央：伝票操作 + メニュー */}
        <section aria-label="オーダー" style={{ minWidth: 0 }}>
          {!selectedTableId ? (
            <Empty>左の卓を選択してください。</Empty>
          ) : (
            <>
              <PaneTitle>{selectedTable?.name} の伝票</PaneTitle>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
                {slips.map((sl) => (
                  <button key={sl.id} type="button" onClick={() => setSelectedSlipId(sl.id)} style={chipStyle(sl.id === selectedSlipId)}>{sl.name}</button>
                ))}
                <button type="button" onClick={() => setNewSlipFor(selectedTableId)} style={{ ...chipStyle(false), borderStyle: 'dashed', color: 'var(--noxa-accent-primary-ink)', borderColor: 'var(--noxa-border-strong)' }}>＋ 伝票</button>
              </div>

              {!selectedSlip ? (
                <Empty>「＋ 伝票」で新しい伝票を開いてください。</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <SlipControls slip={selectedSlip} initialSetPriceOptions={config.initialSetPriceOptions} onDispatch={(a) => store.dispatchSlip(selectedTableId, selectedSlip.id, a)} />

                  {/* クイック（缶モノ等のピン留め） */}
                  {config.pinnedOrders.length > 0 && (
                    <div>
                      <div style={{ ...miniLabel, marginBottom: 6 }}>クイック</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {config.pinnedOrders.map((p) => (
                          <button key={p.name} type="button"
                            onClick={() => store.dispatchSlip(selectedTableId, selectedSlip.id, { type: 'ADD_ORDER', payload: { name: p.name, price: p.price, canHalfOff: p.canHalfOff } })}
                            style={{ ...chipStyle(false), borderColor: 'var(--noxa-border-strong)' }}>
                            {p.name}{p.canHalfOff ? <span style={{ color: 'var(--noxa-text-faint)', fontSize: 9, marginLeft: 3 }}>半</span> : null}
                            <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-accent-primary-ink)', marginLeft: 6 }}>{yen(p.price)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* メニュー */}
                  <div>
                    <div role="tablist" aria-label="メニューカテゴリ" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
                      {config.menuCategories.map((c) => (
                        <button key={c.id} type="button" role="tab" aria-selected={c.id === activeCategory} onClick={() => setActiveCategory(c.id)} style={chipStyle(c.id === activeCategory)}>{c.label}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
                      {categoryItems.map((m) => (
                        <button key={m.name} type="button" onClick={() => addItem(m)} aria-label={`${m.name} を追加`}
                          style={{ appearance: 'none', cursor: 'pointer', textAlign: 'left', minHeight: 70, padding: '11px 13px', borderRadius: 14, background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{m.name}{m.canHalfOff ? <span style={{ color: 'var(--noxa-text-faint)', fontSize: 10, marginLeft: 4 }}>半</span> : null}</span>
                          <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--noxa-accent-primary-ink)' }}>{m.isCustom ? '金額入力' : yen(m.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* 右：会計 */}
        <section aria-label={checkoutLabel}>
          <PaneTitle>{checkoutLabel}</PaneTitle>
          {selectedSlip && result && selectedTableId ? (
            <BillPanel
              key={selectedSlip.id}
              tableName={selectedTable?.name ?? ''}
              casts={(selectedTable?.currentHostIds ?? []).map((cid) => castById.get(cid) ?? '?')}
              slip={selectedSlip}
              result={result}
              onDispatch={(a) => store.dispatchSlip(selectedTableId, selectedSlip.id, a)}
              onRename={(name) => store.renameSlip(selectedTableId, selectedSlip.id, name)}
              onRemove={() => { if (window.confirm('この伝票を破棄しますか？（売上に計上されません）')) { store.removeSlip(selectedTableId, selectedSlip.id); setSelectedSlipId(null); } }}
              onCheckout={async (opts) => { await store.checkoutSlip(selectedTableId, selectedSlip.id, opts); setSelectedSlipId(null); }}
            />
          ) : (
            <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 20, color: 'var(--noxa-text-muted)', fontSize: 13 }}>伝票を選択すると会計伝票が表示されます。</div>
          )}
        </section>
      </div>

      {/* 新規伝票（担当キャスト・顧客名を選択） */}
      {newSlipFor && (
        <NewSlipDialog
          tableName={tables.find((t) => t.id === newSlipFor)?.name ?? ''}
          casts={casts}
          customers={store.customers}
          tableCastIds={tables.find((t) => t.id === newSlipFor)?.currentHostIds ?? []}
          onClose={() => setNewSlipFor(null)}
          onCreate={(init) => createSlip(newSlipFor, init)}
        />
      )}

      {/* オリシャン等の金額入力 */}
      {customItem && selectedTableId && selectedSlip && (
        <CustomPriceDialog
          name={customItem.name}
          onClose={() => setCustomItem(null)}
          onAdd={(name, price) => {
            store.dispatchSlip(selectedTableId, selectedSlip.id, { type: 'ADD_ORDER', payload: { name, price } });
            setCustomItem(null);
          }}
        />
      )}
    </Shell>
  );
}

// ───────────────────────── オリシャン等の金額入力ダイアログ

function CustomPriceDialog({ name, onClose, onAdd }: { name: string; onClose: () => void; onAdd: (name: string, price: number) => void }) {
  const [label, setLabel] = useState(name === 'オリシャン / その他' ? '' : name);
  const [price, setPrice] = useState<number>(0);
  return (
    <div role="dialog" aria-label="金額入力" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(360px, 92vw)', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="noxa-eyebrow" style={{ fontSize: 11 }}>{name} · 金額入力</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={miniLabel}>品名</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：オリジナルシャンパン" style={fieldStyle} autoFocus />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={miniLabel}>金額（税抜）</span>
          <input type="number" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))} inputMode="numeric" style={fieldStyle} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1 }} disabled={price <= 0 || !label.trim()}
            onClick={() => onAdd(label.trim(), price)}>追加</button>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, width: 80 }}>戻る</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 新規伝票ダイアログ（担当キャスト・顧客名）

function NewSlipDialog({ tableName, casts, customers, tableCastIds, onClose, onCreate }: {
  tableName: string; casts: Cast[]; customers: ShopCustomer[]; tableCastIds: string[];
  onClose: () => void;
  onCreate: (init: { castName?: string; castUid?: string; castId?: string; customerName?: string; customerId?: string; customerType?: CustomerType }) => void;
}) {
  // 卓に配置済みキャストを先頭に、その他を続ける
  const sortedCasts = useMemo(() => {
    const onTable = casts.filter((c) => tableCastIds.includes(c.id));
    const others = casts.filter((c) => !tableCastIds.includes(c.id));
    return [...onTable, ...others];
  }, [casts, tableCastIds]);
  const [castId, setCastId] = useState<string>(() => casts.find((c) => tableCastIds.includes(c.id))?.id ?? '');
  const [customerType, setCustomerType] = useState<CustomerType>('regular');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);

  const selectedCast = casts.find((c) => c.id === castId);
  // 選択中キャストの担当顧客（mainCastId 一致 or アカウント uid 一致）
  const castCustomers = useMemo(() => {
    if (!castId && !selectedCast?.uid) return [];
    return customers.filter((c) => (castId && c.mainCastId === castId) || (selectedCast?.uid && c.mainCastUid === selectedCast.uid));
  }, [customers, castId, selectedCast]);
  const isNew = customerType === 'initial';

  const onTypeCustomer = (v: string) => { setCustomerName(v); setCustomerId(undefined); };

  return (
    <div role="dialog" aria-label="新規伝票" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 94vw)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border-strong)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="noxa-eyebrow" style={{ fontSize: 11 }}>{tableName} · 新規伝票</div>

        {/* 客層 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={miniLabel}>客層</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CUSTOMER_TYPES.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCustomerType(c.id); if (c.id === 'initial') { setCustomerId(undefined); } }} style={chipStyle(customerType === c.id)}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* 担当キャスト */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={miniLabel}>担当（指名）キャスト</span>
          {sortedCasts.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>キャスト未登録（席回しで追加 or テストデータ投入）</span>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 140, overflowY: 'auto' }}>
              <button type="button" onClick={() => { setCastId(''); setCustomerId(undefined); }} style={chipStyle(castId === '')}>指定なし</button>
              {sortedCasts.map((c) => (
                <button key={c.id} type="button" onClick={() => { setCastId(c.id); setCustomerId(undefined); }} style={chipStyle(castId === c.id)}>
                  {tableCastIds.includes(c.id) ? '★' : ''}{c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 顧客（新規=入力 / それ以外=担当キャストの顧客から選択） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={miniLabel}>{isNew ? '顧客名（新規・任意）' : '顧客（担当の既存客から選択）'}</span>
          {isNew ? (
            <input value={customerName} onChange={(e) => onTypeCustomer(e.target.value)} placeholder="例：田中様" style={fieldStyle} autoFocus />
          ) : !castId ? (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>担当キャストを選ぶと、その顧客から選べます（または下に入力）。</span>
          ) : castCustomers.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>この担当の既存顧客はいません。下に入力してください。</span>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 140, overflowY: 'auto' }}>
              {castCustomers.map((c) => (
                <button key={c.id} type="button" onClick={() => { setCustomerName(c.name); setCustomerId(c.id); }} style={chipStyle(customerId === c.id)}>{c.name}</button>
              ))}
            </div>
          )}
          {!isNew && (
            <input value={customerId ? '' : customerName} onChange={(e) => onTypeCustomer(e.target.value)} placeholder="その他（手入力）" style={{ ...fieldStyle, marginTop: 4 }} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="noxa-btn noxa-btn-primary" style={{ ...primaryBtn, flex: 1 }}
            onClick={() => {
              const cast = casts.find((c) => c.id === castId);
              onCreate({
                castName: cast?.name || undefined,
                castUid: cast?.uid || undefined,
                castId: castId || undefined,
                customerName: customerName.trim() || undefined,
                customerId: customerId || undefined,
                customerType,
              });
            }}>
            伝票を作成
          </button>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, width: 80 }}>戻る</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 伝票コントロール

function SlipControls({ slip, initialSetPriceOptions, onDispatch }: { slip: PosSlip; initialSetPriceOptions: number[]; onDispatch: (a: Action) => void }) {
  const s = slip.state;
  const [showEvents, setShowEvents] = useState(false);
  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CUSTOMER_TYPES.map((c) => (
          <button key={c.id} type="button" onClick={() => onDispatch({ type: 'SET_CUSTOMER_TYPE', payload: c.id })} style={chipStyle(s.customerType === c.id)}>{c.label}</button>
        ))}
      </div>
      {s.customerType === 'initial' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={miniLabel}>初回セット</span>
          {initialSetPriceOptions.map((p) => (
            <button key={p} type="button" onClick={() => onDispatch({ type: 'SET_INITIAL_SET_PRICE', payload: p })} style={chipStyle(s.initialSetPrice === p)}>{yen(p)}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={miniLabel}>入店</span>
          <input type="time" value={s.entryTime} onChange={(e) => onDispatch({ type: 'SET_ENTRY_TIME', payload: e.target.value })} style={{ minHeight: 36, padding: '4px 8px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontFamily: mono, fontSize: 14 }} />
        </label>
        <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_DOHAN' })} style={chipStyle(s.dohan)}>同伴</button>
        <CountStepper label="複数指名" value={s.additionalNominationCount} onChange={(v) => onDispatch({ type: 'SET_ADDITIONAL_NOMINATION_COUNT', payload: v })} />
        <button type="button" onClick={() => setShowEvents((v) => !v)} style={{ ...chipStyle(false), marginLeft: 'auto' }}>イベント {showEvents ? '▲' : '▼'}</button>
      </div>
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

function BillPanel({ tableName, casts, slip, result, onDispatch, onRename, onRemove, onCheckout }: {
  tableName: string; casts: string[]; slip: PosSlip; result: CalculationResult;
  onDispatch: (a: Action) => void; onRename: (name: string) => void; onRemove: () => void;
  onCheckout: (opts: { amount: number; castName?: string; customerName?: string; guests?: number }) => Promise<void>;
}) {
  const activeOrders = slip.state.orders.filter((o) => o.count > 0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [amount, setAmount] = useState<number>(result.currentTotal);
  const [castName, setCastName] = useState(slip.castName ?? casts[0] ?? '');
  const [customerName, setCustomerName] = useState(slip.customerName ?? '');
  const [guests, setGuests] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmount(result.currentTotal); }, [result.currentTotal]);

  return (
    <div style={{ background: 'var(--noxa-surface-card)', border: '1px solid var(--noxa-border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--noxa-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontSize: 17, fontWeight: 500 }}>{tableName}</span>
          <input value={slip.name} onChange={(e) => onRename(e.target.value)} aria-label="伝票名" style={{ width: 64, minHeight: 30, padding: '2px 6px', borderRadius: 8, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 13 }} />
        </div>
        {result.isOutOfHours && <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--noxa-status-warning)' }}>営業時間外</span>}
      </div>
      {(slip.customerName || slip.castName || casts.length > 0) && (
        <div style={{ fontSize: 11, color: 'var(--noxa-text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {slip.customerName && <span>顧客：{slip.customerName}</span>}
          {slip.castName ? <span>担当：{slip.castName}</span> : (casts.length > 0 && <span>卓キャスト：{casts.join(' / ')}</span>)}
        </div>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
        {activeOrders.length === 0 && <li style={{ fontSize: 12, color: 'var(--noxa-text-faint)' }}>オーダー未入力</li>}
        {activeOrders.map((o) => <OrderRow key={o.id} order={o} onDispatch={onDispatch} />)}
      </ul>

      <div style={{ borderTop: '1px solid var(--noxa-divider)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {result.breakdown.filter((b) => b.amount !== 0 || b.isTotal).map((b, i) => <BreakdownRow key={i} item={b} />)}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--noxa-border-strong)' }}>
        <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--noxa-text-muted)' }}>現在合計</span>
        <span className="noxa-display" style={{ fontFamily: 'var(--noxa-font-display-en)', fontSize: 30, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{yen(result.currentTotal)}</span>
      </div>

      {!checkingOut ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" onClick={() => setCheckingOut(true)} className="noxa-btn noxa-btn-primary" style={primaryBtn} disabled={activeOrders.length === 0 && result.currentTotal === 0}>会計する → 売上へ計上</button>
          <button type="button" onClick={onRemove} className="noxa-btn noxa-btn-ghost" style={{ ...ghostBtn, width: '100%' }}>伝票を破棄</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--noxa-divider)', paddingTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={miniLabel}>確定金額</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={fieldStyle} inputMode="numeric" />
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
              onClick={async () => { setBusy(true); try { await onCheckout({ amount, castName: castName || undefined, customerName: customerName || undefined, guests }); } finally { setBusy(false); setCheckingOut(false); } }}>
              {busy ? '計上中…' : `${yen(amount)} で確定`}
            </button>
            <button type="button" onClick={() => setCheckingOut(false)} className="noxa-btn noxa-btn-ghost" style={{ ...ghostBtn, width: 80 }}>戻る</button>
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 10, lineHeight: 1.6, color: 'var(--noxa-text-faint)', fontFamily: mono }}>※ 決済は既存レジ運用。会計確定で売上データ（②）へ転記されます。</p>
    </div>
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
        {order.canHalfOff && (
          <button type="button" onClick={() => onDispatch({ type: 'TOGGLE_ORDER_HALF_OFF', payload: order.id })} title="半額切替" style={{ ...stepBtn, width: 26, color: order.isHalfOff ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)', borderColor: order.isHalfOff ? 'var(--noxa-accent-primary)' : 'var(--noxa-border)' }}>半</button>
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

// ───────────────────────── レイアウト・スタイル

function Shell({ children, device, configurable, embedded }: { children: React.ReactNode; device?: boolean; configurable?: boolean; embedded?: boolean }) {
  if (embedded) return <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)' }}>{children}</div>;
  return (
    <div style={{ color: 'var(--noxa-text-primary)', fontFamily: 'var(--noxa-font-sans-jp)', borderRadius: 16, border: '1px solid var(--noxa-border)', padding: 'clamp(16px, 3vw, 28px)', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', top: '-30%', right: '-10%', width: 700, height: 420, background: 'radial-gradient(ellipse, rgba(139, 92, 246, 0.12) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol style={{ display: 'flex', gap: 8, fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', color: 'var(--noxa-text-faint)', listStyle: 'none', margin: 0, padding: 0 }}>
            <li><Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>Noxa OS</Link></li>
            <li aria-hidden>·</li><li>pos</li>
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {configurable && (
              <Link href="/pos/settings" className="noxa-btn noxa-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 9999, border: '1px solid var(--noxa-border-strong)', background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)', fontSize: 12, textDecoration: 'none' }}>⚙ POS設定</Link>
            )}
            <span role="note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', borderRadius: 9999, fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', color: 'var(--noxa-status-success)', textTransform: 'uppercase' }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--noxa-status-success)', boxShadow: '0 0 8px var(--noxa-status-success)' }} />
              {device ? '店舗端末 · 実データ' : '実データ · 席回し同期'}
            </span>
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
    boxShadow: active ? 'var(--noxa-glow-soft)' : 'none', transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
  };
}
const stepBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', width: 28, height: 28, borderRadius: 8, flex: 'none', background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 15, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const fieldStyle: React.CSSProperties = { width: '100%', minHeight: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-primary)', fontSize: 16 };
const primaryBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', width: '100%', minHeight: 46, borderRadius: 12, border: '1px solid var(--noxa-accent-primary)', background: 'var(--noxa-accent-primary)', color: '#fff', fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 15, fontWeight: 600, boxShadow: 'var(--noxa-glow-soft)' };
const ghostBtn: React.CSSProperties = { appearance: 'none', cursor: 'pointer', minHeight: 40, borderRadius: 12, border: '1px solid var(--noxa-border-strong)', background: 'var(--noxa-surface-muted)', color: 'var(--noxa-text-muted)', fontFamily: 'var(--noxa-font-sans-jp)', fontSize: 13, fontWeight: 500 };

export default PosClient;
