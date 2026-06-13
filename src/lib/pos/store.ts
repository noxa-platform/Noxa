'use client';

/**
 * POS の Firestore 永続化層（席回しと卓ドキュメントを統合＝完全同期）。
 *
 * データモデル（席回しと共有・既存ルール準拠）:
 *   shop_shops/{shopId}/pos_config/active           … StoreConfig（owner/manager のみ書込可）
 *   shop_shops/{shopId}/seating_tables/{tableId}    … 卓の統合状態（席回し＋POS）
 *       seating: status/customers/currentHostIds/mainHostIds/castStartTimes/...
 *       POS    : slips: PosSlip[]
 *   shop_shops/{shopId}/sales/{saleId}              … 会計済み売上
 *
 * POS で伝票を開く＝同じ卓ドキュメントの slips に追加。席回しでキャストを配置すると
 * 同じ卓に反映され、POS 画面でもキャストが見える（逆も同様）。会計は sales に転記。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp, increment,
  query, where, getDocs, runTransaction, type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { getActiveShop, pickShopId } from '@/lib/workspace';
import type { StoreConfig } from './types';
import { createDefaultStoreConfig } from './defaultConfig';
import {
  calculatorReducer, calculateResult, createInitialState, createPinnedOrders,
  type Action, type CalculatorState, type CalculationResult, type CustomerType, type PosSlip,
} from './engine';
import type { FloorTable, Cast } from '@/lib/seating/types';
import { createEmptyTable } from '@/lib/seating/types';

const SLIP_NAMES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
function nextSlipName(slips: PosSlip[]): string {
  return SLIP_NAMES[slips.length] ?? `⑪+${slips.length - 10}`;
}

import { DEFAULT_TABLE_NAMES } from '@/lib/seating/tables';

export function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

import { businessDayKey as dayKey } from '@/lib/datetime';

export type ShopCustomer = { id: string; name: string; mainCastId?: string | null; mainCastUid?: string | null };

export type PosShopContext = {
  loading: boolean; shopId: string | null; canConfig: boolean; isDevice: boolean; error: string | null;
};

function usePosShop(user: User): PosShopContext {
  const device = useDeviceClaims(user);
  const [ctx, setCtx] = useState<PosShopContext>({ loading: true, shopId: null, canConfig: false, isDevice: false, error: null });
  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      if (device.isDevice && device.shopId) {
        if (alive) setCtx({ loading: false, shopId: device.shopId, canConfig: false, isDevice: true, error: null });
        return;
      }
      try {
        const snap = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
        if (!alive) return;
        const { shopId, isOwner } = pickShopId(snap.docs.map((d) => d.id), ms.docs.map((d) => d.id), getActiveShop());
        setCtx({ loading: false, shopId, canConfig: isOwner, isDevice: false, error: null });
      } catch (e) {
        if (alive) setCtx({ loading: false, shopId: null, canConfig: false, isDevice: false, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);
  return ctx;
}

export type UsePosStore = {
  loading: boolean;
  shopId: string | null;
  canConfig: boolean;
  isDevice: boolean;
  error: string | null;
  config: StoreConfig;
  tables: FloorTable[];
  casts: Cast[];
  customers: ShopCustomer[];
  needsSeed: boolean;
  seedTables: () => Promise<void>;
  addSlip: (tableId: string, init?: { customerType?: CustomerType; initialSetPrice?: number; entryTime?: string; dohan?: boolean; castName?: string; castUid?: string; castId?: string; customerName?: string; customerId?: string }) => Promise<void>;
  dispatchSlip: (tableId: string, slipId: string, action: Action) => Promise<void>;
  renameSlip: (tableId: string, slipId: string, name: string) => Promise<void>;
  removeSlip: (tableId: string, slipId: string) => Promise<void>;
  checkoutSlip: (tableId: string, slipId: string, opts: { amount: number; castName?: string; customerName?: string; guests?: number }) => Promise<void>;
  resultFor: (slip: PosSlip) => CalculationResult;
};

export function usePosStore(user: User): UsePosStore {
  const shop = usePosShop(user);
  const shopId = shop.shopId;

  const [config, setConfig] = useState<StoreConfig>(() => createDefaultStoreConfig());
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const configRef = useRef(config);
  // 売上の付け方（店舗設定 config/settings.salesAttribution）。会計時の帰属に使用
  const attributionRef = useRef<'mainCast' | 'operator'>('mainCast');

  // 店舗設定（売上の付け方）を購読
  useEffect(() => {
    if (!shopId) return;
    const unsub = onSnapshot(doc(db, `shop_shops/${shopId}/config/settings`), (snap) => {
      const a = snap.exists() ? (snap.data() as { salesAttribution?: string }).salesAttribution : undefined;
      attributionRef.current = a === 'operator' ? 'operator' : 'mainCast';
    }, () => { /* 既定 mainCast */ });
    return () => unsub();
  }, [shopId]);

  // pos_config（無ければ owner のみ seed）
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    (async () => {
      try {
        const ref = doc(db, `shop_shops/${shopId}/pos_config/active`);
        const snap = await getDoc(ref);
        if (!alive) return;
        if (snap.exists()) {
          setConfig({ ...createDefaultStoreConfig('active'), ...(snap.data() as Partial<StoreConfig>) } as StoreConfig);
        } else if (shop.canConfig) {
          const seed = createDefaultStoreConfig('active');
          await setDoc(ref, { ...seed, updatedAt: serverTimestamp() });
          if (alive) setConfig(seed);
        } else {
          setConfig(createDefaultStoreConfig('active'));
        }
      } catch {
        if (alive) setConfig(createDefaultStoreConfig('active'));
      }
    })();
    return () => { alive = false; };
  }, [shopId, shop.canConfig]);

  // 卓（seating_tables）購読
  useEffect(() => {
    if (!shopId) { setLoadingData(false); return; }
    setLoadingData(true);
    const unsubT = onSnapshot(collection(db, `shop_shops/${shopId}/seating_tables`), (snap) => {
      const list: FloorTable[] = [];
      snap.forEach((d) => list.push({ ...createEmptyTable(d.id, d.id), ...(d.data() as Partial<FloorTable>), id: d.id } as FloorTable));
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setTables(list);
      setLoadingData(false);
    }, () => setLoadingData(false));
    const unsubC = onSnapshot(collection(db, `shop_shops/${shopId}/seating_casts`), (snap) => {
      const list: Cast[] = [];
      snap.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        list.push({ id: d.id, name: (x.name as string) ?? '?', rank: (x.rank as Cast['rank']) ?? '非役職', hourlyWage: (x.hourlyWage as number) ?? 0, isLocked: !!x.isLocked, status: 'Free', currentTableId: null, uid: (x.uid as string) ?? null });
      });
      setCasts(list);
    }, (e) => console.warn('[noxa:pos] キャスト購読エラー', e?.message ?? e));
    const unsubCust = onSnapshot(collection(db, `shop_shops/${shopId}/customers`), (snap) => {
      const list: ShopCustomer[] = [];
      snap.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        list.push({ id: d.id, name: (x.name as string) ?? '（無名）', mainCastId: (x.mainCastId as string) ?? null, mainCastUid: (x.mainCastUid as string) ?? null });
      });
      setCustomers(list);
    }, () => { /* 権限等で読めない場合は空 */ });
    return () => { unsubT(); unsubC(); unsubCust(); };
  }, [shopId]);

  configRef.current = config;

  const tableRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_tables/${id}`), [shopId]);

  const seedTables = useCallback<UsePosStore['seedTables']>(async () => {
    if (!shopId) return;
    let names = DEFAULT_TABLE_NAMES;
    try {
      const tn = configRef.current.tableNames;
      if (Array.isArray(tn) && tn.length) names = tn;
    } catch { /* ignore */ }
    await Promise.all(names.map((name, i) =>
      setDoc(doc(db, `shop_shops/${shopId}/seating_tables/tbl_${i + 1}`), { ...createEmptyTable(`tbl_${i + 1}`, name), updatedAt: serverTimestamp() })));
  }, [shopId, configRef]);

  // Firestore は undefined を拒否するため、書込前に undefined を除去（JSON 往復）
  // 伝票の読み取り→変更→書き戻しをトランザクションで実行（複数端末の同時編集での消失を防ぐ）。
  // transform はサーバ最新の slips と卓データを受け取り、新 slips と卓への追加更新(extra)を返す。
  const txSlips = useCallback(async (
    tableId: string,
    transform: (slips: PosSlip[], data: DocumentData) => { slips: PosSlip[]; extra?: Record<string, unknown> } | null,
  ) => {
    if (!shopId) return;
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const slips: PosSlip[] = Array.isArray(data.slips) ? (data.slips as PosSlip[]) : [];
      const result = transform(slips, data);
      if (!result) return;
      const clean = JSON.parse(JSON.stringify(result.slips));
      tx.set(ref, { slips: clean, updatedAt: serverTimestamp(), ...(result.extra ?? {}) }, { merge: true });
    });
  }, [shopId, tableRef]);

  const addSlip = useCallback<UsePosStore['addSlip']>(async (tableId, init) => {
    const cfg = configRef.current;
    const base = createInitialState(cfg);
    const state: CalculatorState = init
      ? { ...base, customerType: init.customerType ?? base.customerType, initialSetPrice: init.initialSetPrice ?? base.initialSetPrice, entryTime: init.entryTime ?? base.entryTime, dohan: init.dohan ?? base.dohan, orders: createPinnedOrders(cfg, init.customerType ?? base.customerType) }
      : base;
    // 整合: castId 未指定でも castName から席回しキャストを解決し、必ず卓に配置する
    const resolvedCastId = init?.castId ?? (init?.castName ? casts.find((c) => c.name === init.castName)?.id : undefined);
    await txSlips(tableId, (slips, data) => {
      const newSlip: PosSlip = {
        id: genSlipId(),
        name: init?.customerName?.trim() ? init.customerName.trim() : nextSlipName(slips),
        state,
        ...(init?.castName ? { castName: init.castName } : {}),
        ...(init?.castUid ? { castUid: init.castUid } : {}),
        ...(resolvedCastId ? { castId: resolvedCastId } : {}),
        ...(init?.customerName?.trim() ? { customerName: init.customerName.trim() } : {}),
        ...(init?.customerId ? { customerId: init.customerId } : {}),
      };
      const extra: Record<string, unknown> = {};
      if (!data.status || data.status === 'EMPTY') { extra.status = 'ACTIVE'; extra.startTime = Date.now(); extra.entryTime = Date.now(); }
      if (resolvedCastId) {
        const cur: string[] = Array.isArray(data.currentHostIds) ? data.currentHostIds : [];
        const main: string[] = Array.isArray(data.mainHostIds) ? data.mainHostIds : [];
        extra.currentHostIds = cur.includes(resolvedCastId) ? cur : [...cur, resolvedCastId];
        extra.mainHostIds = main.includes(resolvedCastId) ? main : [...main, resolvedCastId];
        extra.castStartTimes = { ...(data.castStartTimes ?? {}), [resolvedCastId]: Date.now() };
      }
      return { slips: [...slips, newSlip], extra };
    });
  }, [configRef, txSlips, casts]);

  const mutateSlip = useCallback(async (tableId: string, slipId: string, fn: (s: PosSlip) => PosSlip | null) => {
    await txSlips(tableId, (slips) => {
      const next: PosSlip[] = [];
      for (const s of slips) { if (s.id === slipId) { const r = fn(s); if (r) next.push(r); } else next.push(s); }
      return { slips: next };
    });
  }, [txSlips]);

  const dispatchSlip = useCallback<UsePosStore['dispatchSlip']>(async (tableId, slipId, action) => {
    await mutateSlip(tableId, slipId, (s) => ({ ...s, state: calculatorReducer(s.state, action, configRef.current) }));
  }, [mutateSlip, configRef]);

  const renameSlip = useCallback<UsePosStore['renameSlip']>(async (tableId, slipId, name) => {
    await mutateSlip(tableId, slipId, (s) => ({ ...s, name }));
  }, [mutateSlip]);

  const removeSlip = useCallback<UsePosStore['removeSlip']>(async (tableId, slipId) => {
    await mutateSlip(tableId, slipId, () => null);
  }, [mutateSlip]);

  const checkoutSlip = useCallback<UsePosStore['checkoutSlip']>(async (tableId, slipId, opts) => {
    if (!shopId) return;
    // 売上転記＋伝票削除を単一トランザクションで（二重計上/取りこぼし防止・同時編集に安全）
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const slips: PosSlip[] = Array.isArray(data.slips) ? (data.slips as PosSlip[]) : [];
      const slip = slips.find((s) => s.id === slipId);
      if (!slip) return; // 既に会計済み（他端末）等
      // 内訳（注文品目）のスナップショット。会計後も「何を何本」を残すため sales に保存する。
      // count>0 の品目のみ。合計 amount は set/税/指名等を含むため lineItems の和とは一致しない（注文明細のみ）。
      const lineItems = (Array.isArray(slip.state.orders) ? slip.state.orders : [])
        .filter((o) => (o?.count ?? 0) > 0)
        .map((o) => ({ name: o.name, baseName: o.baseName, unitPrice: o.price, count: o.count, amount: o.price * o.count }));
      const saleRef = doc(collection(db, `shop_shops/${shopId}/sales`));
      tx.set(saleRef, {
        source: 'pos', entryMode: 'breakdown', amount: opts.amount, tableId, tableName: (data.name as string) ?? '', slipName: slip.name,
        customerType: slip.state.customerType, customerName: opts.customerName ?? slip.customerName ?? null,
        customerId: slip.customerId ?? null,
        castName: opts.castName ?? slip.castName ?? null,
        castUid: attributionRef.current === 'operator' ? user.uid : (slip.castUid ?? user.uid),
        operatorUid: user.uid,
        guests: opts.guests ?? null,
        lineItems,
        entryTime: slip.state.entryTime, checkoutAt: serverTimestamp(), dayKey: dayKey(), createdAt: serverTimestamp(),
      });
      // 会計→顧客実績を同一トランザクションで更新（紐付け顧客がいれば累計売上・来店・最終接触を反映）
      if (slip.customerId) {
        tx.set(doc(db, `shop_shops/${shopId}/customers/${slip.customerId}`),
          { totalSales: increment(opts.amount), visitCount: increment(1), lastContactAt: serverTimestamp(), updatedAt: serverTimestamp() },
          { merge: true });
      }
      const nextSlips = JSON.parse(JSON.stringify(slips.filter((s) => s.id !== slipId)));
      tx.set(ref, { slips: nextSlips, updatedAt: serverTimestamp() }, { merge: true });
    });
  }, [shopId, tableRef, user.uid]);

  const resultFor = useCallback<UsePosStore['resultFor']>((slip) => {
    const live: CalculatorState = slip.state.isDebugMode ? slip.state : { ...slip.state, currentTime: nowHHMM() };
    return calculateResult(live, configRef.current);
  }, [configRef]);

  const needsSeed = !loadingData && !!shopId && tables.length === 0;

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId, canConfig: shop.canConfig, isDevice: shop.isDevice, error: shop.error,
    config, tables, casts, customers, needsSeed,
    seedTables, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor,
  }), [shop.loading, loadingData, shopId, shop.canConfig, shop.isDevice, shop.error, config, tables, casts, customers, needsSeed, seedTables, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor]);
}

let __slipSeq = 0;
function genSlipId(): string {
  __slipSeq += 1;
  return `s_${__slipSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export type { CalculatorState, CalculationResult, Action, CustomerType, PosSlip };
