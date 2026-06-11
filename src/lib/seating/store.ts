'use client';

/**
 * 席回し（フロア管理）の Firestore 永続化層。
 *
 * データモデル（新規・ルール追加が必要 / 既存ルールは不変更）:
 *   shop_shops/{shopId}/seating_casts/{castId}    … キャスト名簿（rank/wage/lock/baseStatus）
 *   shop_shops/{shopId}/seating_tables/{tableId}  … フロア卓の実状態（配置/客/タイマー）
 *   shop_shops/{shopId}/seating_queue/{itemId}    … 待ち組
 *   shop_shops/{shopId}/seating_meta/state        … 当日連番など
 *
 * キャストの稼働状態（Work/在卓）は卓配置から導出し、Break/Absent のみ名簿に保持。
 * これによりキャスト⇄卓のクロスコレクション不整合を避ける（配置は卓ドキュメントが正）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, addDoc, deleteDoc,
  writeBatch, runTransaction, serverTimestamp, query, where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import type { Cast, CastStatus, FloorTable, QueueItem, TableType, Customer, Rank } from './types';
import { createEmptyTable } from './types';
import { DEFAULT_TABLE_NAMES } from './tables';

type StoredCast = {
  id: string; name: string; rank: Rank; hourlyWage: number; isLocked: boolean;
  baseStatus: Extract<CastStatus, 'Free' | 'Break' | 'Absent'>; imageUrl?: string;
};

// ───────────────────────── shop 解決（POS と同様：デバイス優先 / オーナー shop）

type ShopTarget = { loading: boolean; shopId: string | null; canManage: boolean; isDevice: boolean; error: string | null };

function useShopTarget(user: User): ShopTarget {
  const device = useDeviceClaims(user);
  const [ctx, setCtx] = useState<ShopTarget>({ loading: true, shopId: null, canManage: false, isDevice: false, error: null });
  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      if (device.isDevice && device.shopId) {
        if (alive) setCtx({ loading: false, shopId: device.shopId, canManage: false, isDevice: true, error: null });
        return;
      }
      try {
        const snap = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        if (!alive) return;
        if (snap.empty) { setCtx({ loading: false, shopId: null, canManage: false, isDevice: false, error: null }); return; }
        setCtx({ loading: false, shopId: snap.docs[0].id, canManage: true, isDevice: false, error: null });
      } catch (e) {
        if (alive) setCtx({ loading: false, shopId: null, canManage: false, isDevice: false, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);
  return ctx;
}

// ───────────────────────── 派生：卓配置からキャスト稼働状態を算出

function computeCasts(stored: StoredCast[], tables: FloorTable[]): Cast[] {
  const tableByCast = new Map<string, string>();
  for (const t of tables) for (const cid of t.currentHostIds ?? []) tableByCast.set(cid, t.id);
  return stored.map((s) => ({
    id: s.id, name: s.name, rank: s.rank, hourlyWage: s.hourlyWage, isLocked: s.isLocked, imageUrl: s.imageUrl,
    status: (tableByCast.has(s.id) ? 'Work' : s.baseStatus) as CastStatus,
    currentTableId: tableByCast.get(s.id) ?? null,
  }));
}

export type UseSeatingStore = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;
  isDevice: boolean;
  error: string | null;
  casts: Cast[];
  tables: FloorTable[];
  queue: QueueItem[];
  // cast
  addCast: (c: { name: string; rank: Rank; hourlyWage: number }) => Promise<void>;
  updateCast: (id: string, updates: Partial<StoredCast>) => Promise<void>;
  removeCast: (id: string) => Promise<void>;
  toggleLock: (id: string) => Promise<void>;
  setCastBaseStatus: (id: string, status: StoredCast['baseStatus']) => Promise<void>;
  // table
  seedTables: () => Promise<void>;
  // テスト用：キャスト＋キャスト別顧客データを投入（owner のみ想定）
  seedTestData: () => Promise<void>;
  assignCast: (tableId: string, castId: string) => Promise<void>;
  removeCastFromTable: (tableId: string, castId: string) => Promise<void>;
  toggleMainHost: (tableId: string, castId: string) => Promise<void>;
  toggleRequested: (tableId: string, castId: string) => Promise<void>;
  rotateHosts: (tableId: string) => Promise<void>;
  startSet: (tableId: string, customers: Customer[]) => Promise<void>;
  setTableType: (tableId: string, type: TableType) => Promise<void>;
  checkTable: (tableId: string) => Promise<void>;
  extendTime: (tableId: string, minutes: number) => Promise<void>;
  toggleInnerRotation: (tableId: string) => Promise<void>;
  updateTableSettings: (tableId: string, patch: { setTimeLength?: number; rotationTimeLength?: number }) => Promise<void>;
  setCastExcluded: (tableId: string, castId: string, excluded: boolean) => Promise<void>;
  clearSeedData: () => Promise<void>;
  resetTable: (tableId: string) => Promise<void>;
  // queue
  addToQueue: (item: { name: string; groupSize: number; type: TableType; notes?: string }) => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  seatQueueGroup: (tableId: string, item: QueueItem) => Promise<void>;
};

export function useSeatingStore(user: User): UseSeatingStore {
  const shop = useShopTarget(user);
  const shopId = shop.shopId;

  const [stored, setStored] = useState<StoredCast[]>([]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // 購読
  useEffect(() => {
    if (!shopId) { setLoadingData(false); return; }
    setLoadingData(true);
    const unsubs = [
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_casts`), (snap) => {
        const list: StoredCast[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<StoredCast, 'id'>) }));
        setStored(list);
      }),
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_tables`), (snap) => {
        const list: FloorTable[] = [];
        snap.forEach((d) => list.push({ ...createEmptyTable(d.id, d.id), ...(d.data() as Partial<FloorTable>), id: d.id } as FloorTable));
        list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        setTables(list);
        setLoadingData(false);
      }, () => setLoadingData(false)),
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_queue`), (snap) => {
        const list: QueueItem[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<QueueItem, 'id'>) }));
        list.sort((a, b) => a.joinedAt - b.joinedAt);
        setQueue(list);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [shopId]);

  const casts = useMemo(() => computeCasts(stored, tables), [stored, tables]);

  const tableRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_tables/${id}`), [shopId]);
  const castRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_casts/${id}`), [shopId]);
  const getTable = useCallback((id: string) => tables.find((t) => t.id === id), [tables]);

  const writeTable = useCallback(async (t: FloorTable) => {
    if (!shopId) return;
    await setDoc(tableRef(t.id), { ...t, updatedAt: serverTimestamp() }, { merge: true });
  }, [shopId, tableRef]);

  // ── cast ops
  const addCast = useCallback<UseSeatingStore['addCast']>(async (c) => {
    if (!shopId) return;
    await addDoc(collection(db, `shop_shops/${shopId}/seating_casts`), {
      name: c.name, rank: c.rank, hourlyWage: c.hourlyWage, isLocked: false, baseStatus: 'Free', createdAt: serverTimestamp(),
    });
  }, [shopId]);
  const updateCast = useCallback<UseSeatingStore['updateCast']>(async (id, updates) => {
    if (!shopId) return;
    await setDoc(castRef(id), updates, { merge: true });
  }, [shopId, castRef]);
  const removeCast = useCallback<UseSeatingStore['removeCast']>(async (id) => {
    if (!shopId) return;
    await deleteDoc(castRef(id));
  }, [shopId, castRef]);
  const toggleLock = useCallback<UseSeatingStore['toggleLock']>(async (id) => {
    const c = stored.find((x) => x.id === id);
    await updateCast(id, { isLocked: !(c?.isLocked ?? false) });
  }, [stored, updateCast]);
  const setCastBaseStatus = useCallback<UseSeatingStore['setCastBaseStatus']>(async (id, status) => {
    await updateCast(id, { baseStatus: status });
  }, [updateCast]);

  // ── table ops
  const seedTables = useCallback<UseSeatingStore['seedTables']>(async () => {
    if (!shopId) return;
    // POS の卓名があれば流用、無ければ既定
    let names = DEFAULT_TABLE_NAMES;
    try {
      const cfg = await getDoc(doc(db, `shop_shops/${shopId}/pos_config/active`));
      const tn = cfg.exists() ? (cfg.data().tableNames as string[] | undefined) : undefined;
      if (Array.isArray(tn) && tn.length) names = tn;
    } catch { /* ignore */ }
    // 店舗設定の既定セット長/ローテ間隔を新規卓に反映
    let setLen = 60; let rotLen = 15;
    try {
      const s = await getDoc(doc(db, `shop_shops/${shopId}/config/settings`));
      const sd = s.data() as { setTimeLength?: number; rotationTimeLength?: number } | undefined;
      if (sd?.setTimeLength && sd.setTimeLength > 0) setLen = sd.setTimeLength;
      if (sd?.rotationTimeLength && sd.rotationTimeLength > 0) rotLen = sd.rotationTimeLength;
    } catch { /* ignore */ }
    const batch = writeBatch(db);
    names.forEach((name, i) => {
      const id = `tbl_${i + 1}`;
      batch.set(doc(db, `shop_shops/${shopId}/seating_tables/${id}`), { ...createEmptyTable(id, name), setTimeLength: setLen, rotationTimeLength: rotLen, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }, [shopId]);

  const seedTestData = useCallback<UseSeatingStore['seedTestData']>(async () => {
    if (!shopId) return;
    const SEED_CASTS: { name: string; rank: Rank; hourlyWage: number }[] = [
      { name: 'TO-YA', rank: 'BOSS', hourlyWage: 10000 },
      { name: '祐也', rank: '役職', hourlyWage: 8000 }, { name: '迅', rank: '役職', hourlyWage: 8000 },
      { name: 'ちんすこう', rank: '役職', hourlyWage: 8000 }, { name: '夢麗', rank: '役職', hourlyWage: 7000 },
      { name: '宗', rank: '役職', hourlyWage: 7000 }, { name: 'クロム', rank: '役職', hourlyWage: 7000 },
      { name: '大和', rank: '非役職', hourlyWage: 5000 }, { name: 'スバル', rank: '非役職', hourlyWage: 5000 },
      { name: '琥', rank: '非役職', hourlyWage: 5000 }, { name: 'じゅり', rank: '非役職', hourlyWage: 5000 },
      { name: '聡', rank: '非役職', hourlyWage: 5000 }, { name: '夏目', rank: '非役職', hourlyWage: 5000 },
      { name: 'カヲル', rank: '新人', hourlyWage: 3000 }, { name: 'J', rank: '新人', hourlyWage: 3000 },
    ];
    const RANKS_C = ['VIP', 'ゴールド', 'レギュラー', '新規'];
    const CUST_NAMES = ['田中', '山本', '佐藤', '鈴木', '伊藤', '中村', '小林', '加藤', '吉田', '山田', '松本', '井上', '木村', '林', '清水', '森', '池田', '橋本', '阿部', '石川', '山口', '中島', '前田', '藤田'];
    const now = Date.now();
    const castIds: string[] = [];
    const b1 = writeBatch(db);
    SEED_CASTS.forEach((c, i) => {
      const id = `seedcast_${i + 1}`; castIds.push(id);
      b1.set(doc(db, `shop_shops/${shopId}/seating_casts/${id}`), { name: c.name, rank: c.rank, hourlyWage: c.hourlyWage, isLocked: false, baseStatus: 'Free', seed: true, createdAt: serverTimestamp() });
    });
    await b1.commit();
    const b2 = writeBatch(db);
    CUST_NAMES.forEach((n, i) => {
      const ci = i % SEED_CASTS.length;
      const total = ((i * 37) % 20 + 1) * 25000; // 25,000〜500,000 で分散
      const visits = (i % 8) + 1;
      const daysAgo = (i % 30) + 1;
      b2.set(doc(db, `shop_shops/${shopId}/customers/seedcust_${i + 1}`), {
        name: `${n}様`,
        mainCastId: castIds[ci], castName: SEED_CASTS[ci].name,
        totalSales: total, visitCount: visits,
        rank: RANKS_C[i % RANKS_C.length],
        tags: i % 3 === 0 ? ['常連'] : [],
        lastContactAt: new Date(now - daysAgo * 86400000),
        seed: true, createdAt: serverTimestamp(),
      });
    });
    await b2.commit();
  }, [shopId]);

  const assignCast = useCallback<UseSeatingStore['assignCast']>(async (tableId, castId) => {
    if (!shopId) return;
    const batch = writeBatch(db);
    for (const t of tables) {
      const has = t.currentHostIds.includes(castId);
      if (t.id === tableId) {
        if (has) continue;
        const castStartTimes = { ...t.castStartTimes, [castId]: Date.now() };
        const assignedHistory = t.assignedHistory.includes(castId) ? t.assignedHistory : [...t.assignedHistory, castId];
        batch.set(tableRef(t.id), { currentHostIds: [...t.currentHostIds, castId], castStartTimes, assignedHistory, updatedAt: serverTimestamp() }, { merge: true });
      } else if (has) {
        // 別卓から引き剥がし
        const castStartTimes = { ...t.castStartTimes };
        delete castStartTimes[castId];
        batch.set(tableRef(t.id), {
          currentHostIds: t.currentHostIds.filter((c) => c !== castId),
          mainHostIds: t.mainHostIds.filter((c) => c !== castId),
          castStartTimes, updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    }
    await batch.commit();
  }, [shopId, tables, tableRef]);

  const removeCastFromTable = useCallback<UseSeatingStore['removeCastFromTable']>(async (tableId, castId) => {
    const t = getTable(tableId); if (!t) return;
    const castStartTimes = { ...t.castStartTimes }; delete castStartTimes[castId];
    await writeTable({ ...t, currentHostIds: t.currentHostIds.filter((c) => c !== castId), mainHostIds: t.mainHostIds.filter((c) => c !== castId), castStartTimes });
  }, [getTable, writeTable]);

  const toggleMainHost = useCallback<UseSeatingStore['toggleMainHost']>(async (tableId, castId) => {
    const t = getTable(tableId); if (!t) return;
    const has = t.mainHostIds.includes(castId);
    await writeTable({ ...t, mainHostIds: has ? t.mainHostIds.filter((c) => c !== castId) : [...t.mainHostIds, castId] });
  }, [getTable, writeTable]);

  const toggleRequested = useCallback<UseSeatingStore['toggleRequested']>(async (tableId, castId) => {
    const t = getTable(tableId); if (!t) return;
    const has = t.requestedHostIds.includes(castId);
    await writeTable({ ...t, requestedHostIds: has ? t.requestedHostIds.filter((c) => c !== castId) : [...t.requestedHostIds, castId] });
  }, [getTable, writeTable]);

  const rotateHosts = useCallback<UseSeatingStore['rotateHosts']>(async (tableId) => {
    const t = getTable(tableId); if (!t || t.currentHostIds.length < 2) return;
    const rotated = [...t.currentHostIds];
    const first = rotated.shift();
    if (first) rotated.push(first);
    await writeTable({ ...t, currentHostIds: rotated });
  }, [getTable, writeTable]);

  const startSet = useCallback<UseSeatingStore['startSet']>(async (tableId, customers) => {
    if (!shopId) return;
    const now = Date.now();
    const metaR = doc(db, `shop_shops/${shopId}/seating_meta/state`);
    await runTransaction(db, async (tx) => {
      const metaSnap = await tx.get(metaR);
      const seq = (metaSnap.exists() ? (metaSnap.data().dailySequence as number) : 0) + 1;
      const t = getTable(tableId);
      const castStartTimes = { ...(t?.castStartTimes ?? {}) };
      (t?.currentHostIds ?? []).forEach((cid) => { if (!castStartTimes[cid]) castStartTimes[cid] = now; });
      tx.set(metaR, { dailySequence: seq, updatedAt: serverTimestamp() }, { merge: true });
      tx.set(tableRef(tableId), {
        status: 'ACTIVE', startTime: now, entryTime: now, entryNumber: seq,
        type: customers[0]?.type ?? t?.type ?? '正規',
        customers: customers.map((c) => ({ ...c, entryTime: now })),
        castStartTimes, updatedAt: serverTimestamp(),
      }, { merge: true });
    });
  }, [shopId, getTable, tableRef]);

  const updateTableSettings = useCallback<UseSeatingStore['updateTableSettings']>(async (tableId, patch) => {
    if (!shopId) return;
    const clean: Record<string, number> = {};
    if (typeof patch.setTimeLength === 'number' && patch.setTimeLength > 0) clean.setTimeLength = patch.setTimeLength;
    if (typeof patch.rotationTimeLength === 'number' && patch.rotationTimeLength > 0) clean.rotationTimeLength = patch.rotationTimeLength;
    if (Object.keys(clean).length === 0) return;
    await setDoc(doc(db, `shop_shops/${shopId}/seating_tables/${tableId}`), { ...clean, updatedAt: serverTimestamp() }, { merge: true });
  }, [shopId]);

  const setCastExcluded = useCallback<UseSeatingStore['setCastExcluded']>(async (tableId, castId, excluded) => {
    const t = getTable(tableId); if (!t) return;
    const ex = new Set(t.excludedHostIds ?? []);
    if (excluded) ex.add(castId); else ex.delete(castId);
    await writeTable({ ...t, excludedHostIds: Array.from(ex) });
  }, [getTable, writeTable]);

  // テストデータ整理: seed キャスト削除＋全卓を空席リセット（owner 想定）
  const clearSeedData = useCallback<UseSeatingStore['clearSeedData']>(async () => {
    if (!shopId) return;
    const [cs, ts] = await Promise.all([
      getDocs(collection(db, `shop_shops/${shopId}/seating_casts`)),
      getDocs(collection(db, `shop_shops/${shopId}/seating_tables`)),
    ]);
    const batch = writeBatch(db);
    cs.forEach((d) => { if ((d.data() as { seed?: boolean }).seed === true) batch.delete(d.ref); });
    ts.forEach((d) => { const name = (d.data() as { name?: string }).name ?? d.id; batch.set(d.ref, { ...createEmptyTable(d.id, name), slips: [], updatedAt: serverTimestamp() }); });
    await batch.commit();
  }, [shopId]);

  const setTableType = useCallback<UseSeatingStore['setTableType']>(async (tableId, type) => {
    const t = getTable(tableId); if (!t) return;
    await writeTable({ ...t, type });
  }, [getTable, writeTable]);

  const checkTable = useCallback<UseSeatingStore['checkTable']>(async (tableId) => {
    const t = getTable(tableId); if (!t) return;
    await writeTable({ ...t, status: 'CHECK' });
  }, [getTable, writeTable]);

  const extendTime = useCallback<UseSeatingStore['extendTime']>(async (tableId, minutes) => {
    const t = getTable(tableId); if (!t) return;
    await writeTable({ ...t, setTimeLength: (t.setTimeLength || 60) + minutes });
  }, [getTable, writeTable]);

  const toggleInnerRotation = useCallback<UseSeatingStore['toggleInnerRotation']>(async (tableId) => {
    const t = getTable(tableId); if (!t) return;
    await writeTable({ ...t, innerRotationEnabled: !t.innerRotationEnabled });
  }, [getTable, writeTable]);

  const resetTable = useCallback<UseSeatingStore['resetTable']>(async (tableId) => {
    const t = getTable(tableId); if (!t) return;
    // 退店：席回し状態に加え POS 伝票（slips）も明示的に空へ（統合卓ドキュメント）
    await writeTable({ ...createEmptyTable(t.id, t.name), setTimeLength: t.setTimeLength, innerRotationEnabled: t.innerRotationEnabled, slips: [] });
  }, [getTable, writeTable]);

  // ── queue ops
  const addToQueue = useCallback<UseSeatingStore['addToQueue']>(async (item) => {
    if (!shopId) return;
    await addDoc(collection(db, `shop_shops/${shopId}/seating_queue`), { ...item, joinedAt: Date.now(), createdAt: serverTimestamp() });
  }, [shopId]);
  const removeFromQueue = useCallback<UseSeatingStore['removeFromQueue']>(async (id) => {
    if (!shopId) return;
    await deleteDoc(doc(db, `shop_shops/${shopId}/seating_queue/${id}`));
  }, [shopId]);
  const seatQueueGroup = useCallback<UseSeatingStore['seatQueueGroup']>(async (tableId, item) => {
    const now = Date.now();
    const customers: Customer[] = Array.from({ length: Math.max(1, item.groupSize) }, (_, i) => ({
      id: `cust_${now}_${i}`, name: i === 0 ? item.name : undefined, type: item.type, entryTime: now,
    }));
    await startSet(tableId, customers);
    await removeFromQueue(item.id);
  }, [startSet, removeFromQueue]);

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId, canManage: shop.canManage, isDevice: shop.isDevice, error: shop.error,
    casts, tables, queue,
    addCast, updateCast, removeCast, toggleLock, setCastBaseStatus,
    seedTables, seedTestData, assignCast, removeCastFromTable, toggleMainHost, toggleRequested, rotateHosts,
    startSet, setTableType, checkTable, extendTime, toggleInnerRotation, updateTableSettings, setCastExcluded, clearSeedData, resetTable,
    addToQueue, removeFromQueue, seatQueueGroup,
  }), [
    shop.loading, loadingData, shopId, shop.canManage, shop.isDevice, shop.error, casts, tables, queue,
    addCast, updateCast, removeCast, toggleLock, setCastBaseStatus,
    seedTables, seedTestData, assignCast, removeCastFromTable, toggleMainHost, toggleRequested, rotateHosts,
    startSet, setTableType, checkTable, extendTime, toggleInnerRotation, updateTableSettings, setCastExcluded, clearSeedData, resetTable,
    addToQueue, removeFromQueue, seatQueueGroup,
  ]);
}
