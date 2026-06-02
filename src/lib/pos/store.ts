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
  collection, doc, getDoc, onSnapshot, setDoc, addDoc, serverTimestamp,
  query, where, getDocs,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
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

const DEFAULT_TABLE_NAMES = ['A', 'B-1', 'B-2', 'C-1', 'C-2', 'D', 'E-1', 'E-2', 'E-3'];

export function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function dayKey(d = new Date()): string {
  const base = new Date(d);
  if (base.getHours() < 6) base.setDate(base.getDate() - 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

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
        if (!alive) return;
        if (snap.empty) { setCtx({ loading: false, shopId: null, canConfig: false, isDevice: false, error: null }); return; }
        setCtx({ loading: false, shopId: snap.docs[0].id, canConfig: true, isDevice: false, error: null });
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
  needsSeed: boolean;
  seedTables: () => Promise<void>;
  addSlip: (tableId: string, init?: { customerType?: CustomerType; initialSetPrice?: number; entryTime?: string; dohan?: boolean; castName?: string; customerName?: string }) => Promise<void>;
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
  const [loadingData, setLoadingData] = useState(true);
  const configRef = useRef(config);

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
        list.push({ id: d.id, name: (x.name as string) ?? '?', rank: (x.rank as Cast['rank']) ?? '非役職', hourlyWage: (x.hourlyWage as number) ?? 0, isLocked: !!x.isLocked, status: 'Free', currentTableId: null });
      });
      setCasts(list);
    });
    return () => { unsubT(); unsubC(); };
  }, [shopId]);

  configRef.current = config;

  const tableRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_tables/${id}`), [shopId]);
  const getTable = useCallback((id: string) => tables.find((t) => t.id === id), [tables]);

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
  const writeSlips = useCallback(async (tableId: string, slips: PosSlip[], extra?: Record<string, unknown>) => {
    if (!shopId) return;
    const clean = JSON.parse(JSON.stringify(slips));
    await setDoc(tableRef(tableId), { slips: clean, updatedAt: serverTimestamp(), ...(extra ?? {}) }, { merge: true });
  }, [shopId, tableRef]);

  const addSlip = useCallback<UsePosStore['addSlip']>(async (tableId, init) => {
    const cfg = configRef.current;
    const t = getTable(tableId);
    const base = createInitialState(cfg);
    const state: CalculatorState = init
      ? { ...base, customerType: init.customerType ?? base.customerType, initialSetPrice: init.initialSetPrice ?? base.initialSetPrice, entryTime: init.entryTime ?? base.entryTime, dohan: init.dohan ?? base.dohan, orders: createPinnedOrders(cfg, init.customerType ?? base.customerType) }
      : base;
    const slips = t?.slips ?? [];
    const newSlip: PosSlip = {
      id: genSlipId(),
      name: init?.customerName?.trim() ? init.customerName.trim() : nextSlipName(slips),
      state,
      ...(init?.castName ? { castName: init.castName } : {}),
      ...(init?.customerName?.trim() ? { customerName: init.customerName.trim() } : {}),
    };
    // 空卓なら開卓（席回しと同期：status ACTIVE / startTime）
    const extra = (!t || t.status === 'EMPTY')
      ? { status: 'ACTIVE', startTime: Date.now(), entryTime: Date.now() }
      : {};
    await writeSlips(tableId, [...slips, newSlip], extra);
  }, [configRef, getTable, writeSlips]);

  const mutateSlip = useCallback(async (tableId: string, slipId: string, fn: (s: PosSlip) => PosSlip | null) => {
    const t = getTable(tableId);
    if (!t) return;
    const next: PosSlip[] = [];
    for (const s of t.slips ?? []) {
      if (s.id === slipId) { const r = fn(s); if (r) next.push(r); } else next.push(s);
    }
    await writeSlips(tableId, next);
  }, [getTable, writeSlips]);

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
    const t = getTable(tableId);
    const slip = t?.slips?.find((s) => s.id === slipId);
    if (!t || !slip) return;
    await addDoc(collection(db, `shop_shops/${shopId}/sales`), {
      source: 'pos', amount: opts.amount, tableId, tableName: t.name, slipName: slip.name,
      customerType: slip.state.customerType, customerName: opts.customerName ?? null,
      castName: opts.castName ?? null, castUid: user.uid, guests: opts.guests ?? null,
      entryTime: slip.state.entryTime, checkoutAt: serverTimestamp(), dayKey: dayKey(), createdAt: serverTimestamp(),
    });
    await mutateSlip(tableId, slipId, () => null);
  }, [shopId, getTable, mutateSlip, user.uid]);

  const resultFor = useCallback<UsePosStore['resultFor']>((slip) => {
    const live: CalculatorState = slip.state.isDebugMode ? slip.state : { ...slip.state, currentTime: nowHHMM() };
    return calculateResult(live, configRef.current);
  }, [configRef]);

  const needsSeed = !loadingData && !!shopId && tables.length === 0;

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId, canConfig: shop.canConfig, isDevice: shop.isDevice, error: shop.error,
    config, tables, casts, needsSeed,
    seedTables, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor,
  }), [shop.loading, loadingData, shopId, shop.canConfig, shop.isDevice, shop.error, config, tables, casts, needsSeed, seedTables, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor]);
}

let __slipSeq = 0;
function genSlipId(): string {
  __slipSeq += 1;
  return `s_${__slipSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export type { CalculatorState, CalculationResult, Action, CustomerType, PosSlip };
