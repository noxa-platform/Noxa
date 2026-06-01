'use client';

/**
 * POS の Firestore 永続化層（複数卓 × 複数伝票）。
 *
 * データモデル（既存ルール準拠・ルール変更不要）:
 *   shop_shops/{shopId}/pos_config/active            … StoreConfig（owner/manager のみ書込可）
 *   shop_shops/{shopId}/sessions/{tableId}           … 開卓中の状態（member 書込可）
 *       { tableId, tableName, slips: PosSlip[], status, updatedAt }
 *   shop_shops/{shopId}/sales/{saleId}               … 会計済み売上（sales-edit / 本人 cast）
 *
 * shopId は店舗デバイスログイン（claims.shopId）優先、無ければオーナーの最初の shop。
 * 会計（checkout）すると該当伝票を sales に転記し、session から除去する。
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
  type Action, type CalculatorState, type CalculationResult, type CustomerType,
} from './engine';

export type PosSlip = {
  id: string;
  name: string;
  state: CalculatorState;
};

export type PosSession = {
  tableId: string;
  tableName: string;
  slips: PosSlip[];
  status: 'open' | 'closed';
};

const SLIP_NAMES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
function nextSlipName(slips: PosSlip[]): string {
  return SLIP_NAMES[slips.length] ?? `⑪+${slips.length - 10}`;
}

export function nowHHMM(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function dayKey(d = new Date()): string {
  // 営業日: 6時より前は前日扱い（夜営業）
  const base = new Date(d);
  if (base.getHours() < 6) base.setDate(base.getDate() - 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

export type PosShopContext = {
  loading: boolean;
  shopId: string | null;
  canConfig: boolean; // owner/manager（pos_config 書込可）
  isDevice: boolean;
  error: string | null;
};

/** ログインユーザー（デバイス or オーナー）から操作対象 shopId を解決する。 */
function usePosShop(user: User): PosShopContext {
  const device = useDeviceClaims(user);
  const [ctx, setCtx] = useState<PosShopContext>({ loading: true, shopId: null, canConfig: false, isDevice: false, error: null });

  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      // 1) 店舗デバイスログイン: claims.shopId を使用（config 書込は不可）
      if (device.isDevice && device.shopId) {
        if (alive) setCtx({ loading: false, shopId: device.shopId, canConfig: false, isDevice: true, error: null });
        return;
      }
      // 2) オーナー: 自分が owner の最初の shop
      try {
        const snap = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        if (!alive) return;
        if (snap.empty) {
          setCtx({ loading: false, shopId: null, canConfig: false, isDevice: false, error: null });
          return;
        }
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
  sessions: PosSession[];
  /** 卓を開く / 伝票を1枚追加（初期データ付き） */
  addSlip: (tableId: string, tableName: string, init?: Partial<Pick<CalculatorState, 'customerType' | 'initialSetPrice' | 'entryTime' | 'dohan'>>) => Promise<void>;
  /** 伝票へエンジンアクションを発行 */
  dispatchSlip: (tableId: string, slipId: string, action: Action) => Promise<void>;
  /** 伝票名を変更 */
  renameSlip: (tableId: string, slipId: string, name: string) => Promise<void>;
  /** 伝票を削除（会計せず破棄） */
  removeSlip: (tableId: string, slipId: string) => Promise<void>;
  /** 会計: 伝票を sales に転記し session から除去。確定金額と来店人数を渡す */
  checkoutSlip: (tableId: string, slipId: string, opts: { amount: number; castName?: string; customerName?: string; guests?: number }) => Promise<void>;
  /** 卓の現在伝票から計算結果を得る（currentTime は実時刻で上書き） */
  resultFor: (slip: PosSlip) => CalculationResult;
};

export function usePosStore(user: User): UsePosStore {
  const shop = usePosShop(user);
  const shopId = shop.shopId;

  const [config, setConfig] = useState<StoreConfig>(() => createDefaultStoreConfig());
  const [sessions, setSessions] = useState<PosSession[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const configRef = useRef(config);
  configRef.current = config;

  // pos_config 読込（無ければ owner のみ default を seed）
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

  // sessions リアルタイム購読
  useEffect(() => {
    if (!shopId) { setLoadingData(false); return; }
    setLoadingData(true);
    const col = collection(db, `shop_shops/${shopId}/sessions`);
    const unsub = onSnapshot(col, (snap) => {
      const list: PosSession[] = [];
      snap.forEach((d) => {
        const data = d.data() as Partial<PosSession>;
        if (data.status === 'closed') return;
        list.push({
          tableId: data.tableId ?? d.id,
          tableName: data.tableName ?? d.id,
          slips: Array.isArray(data.slips) ? (data.slips as PosSlip[]) : [],
          status: 'open',
        });
      });
      setSessions(list);
      setLoadingData(false);
    }, () => setLoadingData(false));
    return () => unsub();
  }, [shopId]);

  const sessionRef = useCallback((tableId: string) => doc(db, `shop_shops/${shopId}/sessions/${tableId}`), [shopId]);

  // session を取得（ローカルキャッシュ優先）
  const getSession = useCallback((tableId: string): PosSession | undefined => sessions.find((s) => s.tableId === tableId), [sessions]);

  const persistSession = useCallback(async (session: PosSession) => {
    if (!shopId) return;
    await setDoc(sessionRef(session.tableId), {
      tableId: session.tableId,
      tableName: session.tableName,
      slips: session.slips,
      status: session.slips.length > 0 ? 'open' : 'closed',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [shopId, sessionRef]);

  const addSlip = useCallback<UsePosStore['addSlip']>(async (tableId, tableName, init) => {
    const cfg = configRef.current;
    const existing = getSession(tableId);
    const base = createInitialState(cfg);
    const state: CalculatorState = init
      ? {
          ...base,
          customerType: init.customerType ?? base.customerType,
          initialSetPrice: init.initialSetPrice ?? base.initialSetPrice,
          entryTime: init.entryTime ?? base.entryTime,
          dohan: init.dohan ?? base.dohan,
          orders: createPinnedOrders(cfg, init.customerType ?? base.customerType),
        }
      : base;
    const slips = existing?.slips ?? [];
    const newSlip: PosSlip = { id: genSlipId(), name: nextSlipName(slips), state };
    const session: PosSession = {
      tableId,
      tableName: existing?.tableName ?? tableName,
      slips: [...slips, newSlip],
      status: 'open',
    };
    setSessions((prev) => {
      const others = prev.filter((s) => s.tableId !== tableId);
      return [...others, session];
    });
    await persistSession(session);
  }, [getSession, persistSession]);

  const mutateSlip = useCallback(async (tableId: string, slipId: string, fn: (slip: PosSlip) => PosSlip | null) => {
    const session = getSession(tableId);
    if (!session) return;
    const slips: PosSlip[] = [];
    for (const s of session.slips) {
      if (s.id === slipId) {
        const next = fn(s);
        if (next) slips.push(next);
      } else {
        slips.push(s);
      }
    }
    const next: PosSession = { ...session, slips };
    setSessions((prev) => prev.map((s) => s.tableId === tableId ? next : s).filter((s) => s.slips.length > 0));
    await persistSession(next);
  }, [getSession, persistSession]);

  const dispatchSlip = useCallback<UsePosStore['dispatchSlip']>(async (tableId, slipId, action) => {
    await mutateSlip(tableId, slipId, (slip) => ({ ...slip, state: calculatorReducer(slip.state, action, configRef.current) }));
  }, [mutateSlip]);

  const renameSlip = useCallback<UsePosStore['renameSlip']>(async (tableId, slipId, name) => {
    await mutateSlip(tableId, slipId, (slip) => ({ ...slip, name }));
  }, [mutateSlip]);

  const removeSlip = useCallback<UsePosStore['removeSlip']>(async (tableId, slipId) => {
    await mutateSlip(tableId, slipId, () => null);
  }, [mutateSlip]);

  const checkoutSlip = useCallback<UsePosStore['checkoutSlip']>(async (tableId, slipId, opts) => {
    if (!shopId) return;
    const session = getSession(tableId);
    const slip = session?.slips.find((s) => s.id === slipId);
    if (!session || !slip) return;
    // 1) sales へ転記（= 売上データに追加）
    await addDoc(collection(db, `shop_shops/${shopId}/sales`), {
      source: 'pos',
      amount: opts.amount,
      tableId,
      tableName: session.tableName,
      slipName: slip.name,
      customerType: slip.state.customerType,
      customerName: opts.customerName ?? null,
      castName: opts.castName ?? null,
      castUid: user.uid, // 操作者 UID（ルールの castUid 条件用）
      guests: opts.guests ?? null,
      entryTime: slip.state.entryTime,
      checkoutAt: serverTimestamp(),
      dayKey: dayKey(),
      createdAt: serverTimestamp(),
    });
    // 2) 伝票を session から除去
    await mutateSlip(tableId, slipId, () => null);
  }, [shopId, getSession, mutateSlip, user.uid]);

  const resultFor = useCallback<UsePosStore['resultFor']>((slip) => {
    const live: CalculatorState = slip.state.isDebugMode ? slip.state : { ...slip.state, currentTime: nowHHMM() };
    return calculateResult(live, configRef.current);
  }, []);

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId,
    canConfig: shop.canConfig,
    isDevice: shop.isDevice,
    error: shop.error,
    config,
    sessions,
    addSlip,
    dispatchSlip,
    renameSlip,
    removeSlip,
    checkoutSlip,
    resultFor,
  }), [shop.loading, loadingData, shopId, shop.canConfig, shop.isDevice, shop.error, config, sessions, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor]);
}

let __slipSeq = 0;
function genSlipId(): string {
  __slipSeq += 1;
  return `s_${__slipSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export type { CalculatorState, CalculationResult, Action, CustomerType };
