'use client';

/**
 * 席回し（フロア管理）の Firestore 永続化層。
 *
 * データモデル（新規・ルール追加が必要 / 既存ルールは不変更）:
 *   shop_shops/{shopId}/seating_casts/{castId}    … キャスト名簿（rank/wage/lock/baseStatus）
 *   shop_shops/{shopId}/seating_tables/{tableId}  … フロア卓の実状態（配置/客/タイマー）
 *   shop_shops/{shopId}/seating_queue/{itemId}    … 待ち組
 *   shop_shops/{shopId}/seating_meta/state        … 当日連番（営業日 dayKey で毎日リセット）
 *
 * キャストの稼働状態（Work/在卓）は卓配置から導出し、Break/Absent のみ名簿に保持。
 * これによりキャスト⇄卓のクロスコレクション不整合を避ける（配置は卓ドキュメントが正）。
 *
 * 書込ポリシー（2026-07-03 バグ総ざらいで全面改修）:
 *   - 卓の更新は必ず runTransaction で**最新値を読み直し、変更フィールドのみ**書く。
 *     旧実装はローカル state の卓オブジェクト全体を merge 書きしており、
 *     同一卓ドキュメントに同居する POS 伝票(slips)や他端末の変更を古い値で
 *     巻き戻す事故（伝票消失・二重上書き）が起きていた。
 *   - 判定ロジックは logic.ts（純関数）に分離し単体テストで固定。
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
import { getActiveShop, pickShopId } from '@/lib/workspace';
import { businessDayKey } from '@/lib/datetime';
import {
  computeCasts, rotateOrder, nextDailySequence, canStartSet,
  removeCastPatch, buildAssignPatches, stripCastPatches, toggleInArray, sendToBackOfOrder, pruneCastStartTimes, type TablePatch,
} from './logic';

type StoredCast = {
  id: string; name: string; rank: Rank; hourlyWage: number; isLocked: boolean;
  baseStatus: Extract<CastStatus, 'Free' | 'Break' | 'Absent'>; imageUrl?: string;
  uid?: string | null; // 紐付くアカウント uid（給与/個人売上の帰属用・未連携なら null）
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
        const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
        if (!alive) return;
        const { shopId, isOwner } = pickShopId(snap.docs.map((d) => d.id), ms.docs.map((d) => d.id), getActiveShop());
        setCtx({ loading: false, shopId, canManage: isOwner, isDevice: false, error: null });
      } catch (e) {
        if (alive) setCtx({ loading: false, shopId: null, canManage: false, isDevice: false, error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);
  return ctx;
}

export type UseSeatingStore = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;
  isDevice: boolean;
  error: string | null;
  /** 購読(データ取得)のエラー。権限/接続エラーで空表示のまま成功と区別がつかない問題の可視化用 */
  dataError: string | null;
  casts: Cast[];
  tables: FloorTable[];
  queue: QueueItem[];
  /** 回す順番（初回ローテの采配順・seating_meta/state.rotationOrder） */
  rotationOrder: string[];
  setRotationOrder: (order: string[]) => Promise<void>;
  // cast
  addCast: (c: { name: string; rank: Rank; hourlyWage: number; uid?: string | null }) => Promise<void>;
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
  /** 退店処理。アンドゥ用にリセット直前の卓データを返す（卓が無ければ null） */
  resetTable: (tableId: string) => Promise<Partial<FloorTable> | null>;
  /** 退店アンドゥ。卓が空席のままのときだけスナップショットを書き戻す */
  restoreTable: (tableId: string, snapshot: Partial<FloorTable>) => Promise<void>;
  // queue
  addToQueue: (item: { name: string; groupSize: number; type: TableType; notes?: string }) => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  seatQueueGroup: (tableId: string, item: QueueItem) => Promise<void>;
};

/** Firestore ドキュメント → FloorTable（欠損フィールドは空卓の既定値で補完） */
function toFloorTable(id: string, data: Partial<FloorTable> | undefined): FloorTable {
  return { ...createEmptyTable(id, (data?.name as string) ?? id), ...(data ?? {}), id } as FloorTable;
}

export function useSeatingStore(user: User): UseSeatingStore {
  const shop = useShopTarget(user);
  const shopId = shop.shopId;

  const [stored, setStored] = useState<StoredCast[]>([]);
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [rotationOrder, setRotationOrderState] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // 購読
  useEffect(() => {
    if (!shopId) { setLoadingData(false); return; }
    setLoadingData(true);
    const unsubs = [
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_casts`), (snap) => {
        const list: StoredCast[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<StoredCast, 'id'>) }));
        setStored(list);
      }, (e) => { console.warn('[noxa:seating] キャスト購読エラー', e?.message ?? e); setDataError(`キャスト名簿の取得に失敗（${e?.code ?? e?.message ?? e}）`); }),
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_tables`), (snap) => {
        const list: FloorTable[] = [];
        snap.forEach((d) => list.push(toFloorTable(d.id, d.data() as Partial<FloorTable>)));
        list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        setTables(list);
        setLoadingData(false);
      }, (e) => { setLoadingData(false); setDataError(`卓情報の取得に失敗（${e?.code ?? e?.message ?? e}）`); }),
      onSnapshot(doc(db, `shop_shops/${shopId}/seating_meta/state`), (snap) => {
        const ro = snap.exists() ? (snap.data() as { rotationOrder?: string[] }).rotationOrder : undefined;
        setRotationOrderState(Array.isArray(ro) ? ro : []);
      }, (e) => { console.warn('[noxa:seating] meta購読エラー', e?.message ?? e); }),
      onSnapshot(collection(db, `shop_shops/${shopId}/seating_queue`), (snap) => {
        const list: QueueItem[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<QueueItem, 'id'>) }));
        list.sort((a, b) => a.joinedAt - b.joinedAt);
        setQueue(list);
      }, (e) => { console.warn('[noxa:seating] 待ち組購読エラー', e?.message ?? e); setDataError(`待ち組の取得に失敗（${e?.code ?? e?.message ?? e}）`); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [shopId]);

  const casts = useMemo(() => computeCasts(stored, tables), [stored, tables]);

  const tableRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_tables/${id}`), [shopId]);
  const castRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_casts/${id}`), [shopId]);

  /**
   * 卓更新の共通トランザクション。
   * 最新の卓を読み直して mut() で「変更フィールドのみ」のパッチを作り update で書く。
   * mut が null を返したら書かない（no-op）。卓が存在しなければ何もしない。
   *
   * ⚠ set(merge:true) ではなく update を使う理由: merge はマップ（castStartTimes 等）を
   * 深マージするため「キーを消したパッチ」を書いても削除が反映されない
   * （外したキャストの着席時刻 ghost が残り、次の来店に引き継がれる）。
   * update はトップレベルフィールドを丸ごと置換するのでパッチの意図どおりになる。
   */
  const txUpdateTable = useCallback(async (tableId: string, mut: (fresh: FloorTable) => TablePatch | null) => {
    if (!shopId) return;
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const fresh = toFloorTable(tableId, snap.data() as Partial<FloorTable>);
      const patch = mut(fresh);
      if (!patch || Object.keys(patch).length === 0) return;
      tx.update(ref, { ...patch, updatedAt: serverTimestamp() });
    });
  }, [shopId, tableRef]);

  // ── cast ops
  const addCast = useCallback<UseSeatingStore['addCast']>(async (c) => {
    if (!shopId) return;
    await addDoc(collection(db, `shop_shops/${shopId}/seating_casts`), {
      name: c.name, rank: c.rank, hourlyWage: c.hourlyWage, isLocked: false, baseStatus: 'Free',
      uid: c.uid ?? null, createdAt: serverTimestamp(),
    });
  }, [shopId]);
  const updateCast = useCallback<UseSeatingStore['updateCast']>(async (id, updates) => {
    if (!shopId) return;
    await setDoc(castRef(id), updates, { merge: true });
  }, [shopId, castRef]);
  const removeCast = useCallback<UseSeatingStore['removeCast']>(async (id) => {
    if (!shopId) return;
    // 名簿削除と同時に全卓の配置からも除去（幽霊配置＝卓に「?」が残るのを防ぐ）。
    // 卓は tx 内で最新を読み直し、必要な卓だけ変更フィールドを書く。
    const tableIds = tables.map((t) => t.id);
    await runTransaction(db, async (tx) => {
      const freshTables: FloorTable[] = [];
      for (const tid of tableIds) {
        const snap = await tx.get(tableRef(tid));
        if (snap.exists()) freshTables.push(toFloorTable(tid, snap.data() as Partial<FloorTable>));
      }
      for (const p of stripCastPatches(freshTables, id)) {
        // update で書く（merge だと castStartTimes のキー削除が効かない）
        tx.update(tableRef(p.tableId), { ...p.patch, updatedAt: serverTimestamp() });
      }
      tx.delete(castRef(id));
    });
  }, [shopId, tables, tableRef, castRef]);
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
    // 既存卓は上書きしない（seed の二度押しで稼働中フロアを白紙化しない）
    const existing = await getDocs(collection(db, `shop_shops/${shopId}/seating_tables`));
    const existingIds = new Set(existing.docs.map((d) => d.id));
    const batch = writeBatch(db);
    let created = 0;
    names.forEach((name, i) => {
      const id = `tbl_${i + 1}`;
      if (existingIds.has(id)) return;
      batch.set(doc(db, `shop_shops/${shopId}/seating_tables/${id}`), { ...createEmptyTable(id, name), setTimeLength: setLen, rotationTimeLength: rotLen, updatedAt: serverTimestamp() });
      created++;
    });
    if (created > 0) await batch.commit();
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
    // ローカル state ではなく、トランザクション内で全卓を読み直してから配置を計算する。
    // （2端末が同時に同キャストを別卓へ配置しても「1キャスト=1卓」を保つ）
    const tableIds = tables.map((t) => t.id);
    if (!tableIds.includes(tableId)) tableIds.push(tableId);
    const now = Date.now();
    const metaR = doc(db, `shop_shops/${shopId}/seating_meta/state`);
    await runTransaction(db, async (tx) => {
      const metaSnap = await tx.get(metaR);
      const freshTables: FloorTable[] = [];
      for (const id of tableIds) {
        const snap = await tx.get(tableRef(id));
        if (snap.exists()) freshTables.push(toFloorTable(id, snap.data() as Partial<FloorTable>));
      }
      const patches = buildAssignPatches(freshTables, tableId, castId, now);
      for (const p of patches) {
        // update で書く（merge だと引き剥がし側の castStartTimes キー削除が効かない）
        tx.update(tableRef(p.tableId), { ...p.patch, updatedAt: serverTimestamp() });
      }
      // 卓に付いた人は「回す順番」の最後尾へ（初回ローテの采配順を自動維持）
      const meta = metaSnap.exists() ? (metaSnap.data() as { rotationOrder?: string[] }) : undefined;
      tx.set(metaR, { rotationOrder: sendToBackOfOrder(meta?.rotationOrder, castId), updatedAt: serverTimestamp() }, { merge: true });
    });
  }, [shopId, tables, tableRef]);

  const removeCastFromTable = useCallback<UseSeatingStore['removeCastFromTable']>(async (tableId, castId) => {
    const now = Date.now();
    await txUpdateTable(tableId, (t) => removeCastPatch(t, castId, now)); // now 付き＝回し履歴に記録
  }, [txUpdateTable]);

  const setRotationOrder = useCallback<UseSeatingStore['setRotationOrder']>(async (order) => {
    if (!shopId) return;
    await setDoc(doc(db, `shop_shops/${shopId}/seating_meta/state`), { rotationOrder: order, updatedAt: serverTimestamp() }, { merge: true });
  }, [shopId]);

  const toggleMainHost = useCallback<UseSeatingStore['toggleMainHost']>(async (tableId, castId) => {
    await txUpdateTable(tableId, (t) => ({ mainHostIds: toggleInArray(t.mainHostIds, castId) }));
  }, [txUpdateTable]);

  const toggleRequested = useCallback<UseSeatingStore['toggleRequested']>(async (tableId, castId) => {
    await txUpdateTable(tableId, (t) => ({ requestedHostIds: toggleInArray(t.requestedHostIds, castId) }));
  }, [txUpdateTable]);

  const rotateHosts = useCallback<UseSeatingStore['rotateHosts']>(async (tableId) => {
    await txUpdateTable(tableId, (t) => {
      if ((t.currentHostIds ?? []).length < 2) return null;
      return { currentHostIds: rotateOrder(t.currentHostIds) };
    });
  }, [txUpdateTable]);

  const startSet = useCallback<UseSeatingStore['startSet']>(async (tableId, customers) => {
    if (!shopId) return;
    const now = Date.now();
    const todayKey = businessDayKey();
    const metaR = doc(db, `shop_shops/${shopId}/seating_meta/state`);
    await runTransaction(db, async (tx) => {
      const [metaSnap, tableSnap] = [await tx.get(metaR), await tx.get(tableRef(tableId))];
      if (!tableSnap.exists()) throw new Error('卓が見つかりません');
      const t = toFloorTable(tableId, tableSnap.data() as Partial<FloorTable>);
      // 使用中の卓への二重セット開始を拒否（先客の customers を上書きで潰さない）
      if (!canStartSet(t.status)) throw new Error(`この卓は使用中です（${t.name}）`);
      const meta = metaSnap.exists() ? (metaSnap.data() as { dailySequence?: number; dayKey?: string }) : undefined;
      const seq = nextDailySequence(meta, todayKey); // 営業日が変わったら1から
      // 新しい来店＝着席時刻は現在着席中のキャストのみ引き継ぐ（過去来店の ghost を一掃）
      const castStartTimes = pruneCastStartTimes(t.castStartTimes, t.currentHostIds);
      (t.currentHostIds ?? []).forEach((cid) => { if (!castStartTimes[cid]) castStartTimes[cid] = now; });
      tx.set(metaR, { dailySequence: seq, dayKey: todayKey, updatedAt: serverTimestamp() }, { merge: true });
      tx.update(tableRef(tableId), {
        status: 'ACTIVE', startTime: now, entryTime: now, entryNumber: seq,
        type: customers[0]?.type ?? t.type ?? '正規',
        customers: customers.map((c) => ({ ...c, entryTime: now })),
        extraMinutes: 0, // 新しい来店＝延長リセット
        sessionLog: [], // 回し履歴も来店単位でリセット
        castStartTimes, updatedAt: serverTimestamp(),
      });
    });
  }, [shopId, tableRef]);

  const updateTableSettings = useCallback<UseSeatingStore['updateTableSettings']>(async (tableId, patch) => {
    if (!shopId) return;
    const clean: Record<string, number> = {};
    if (typeof patch.setTimeLength === 'number' && patch.setTimeLength > 0) clean.setTimeLength = patch.setTimeLength;
    if (typeof patch.rotationTimeLength === 'number' && patch.rotationTimeLength > 0) clean.rotationTimeLength = patch.rotationTimeLength;
    if (Object.keys(clean).length === 0) return;
    await setDoc(doc(db, `shop_shops/${shopId}/seating_tables/${tableId}`), { ...clean, updatedAt: serverTimestamp() }, { merge: true });
  }, [shopId]);

  const setCastExcluded = useCallback<UseSeatingStore['setCastExcluded']>(async (tableId, castId, excluded) => {
    await txUpdateTable(tableId, (t) => {
      const ex = new Set(t.excludedHostIds ?? []);
      if (excluded) ex.add(castId); else ex.delete(castId);
      return { excludedHostIds: Array.from(ex) };
    });
  }, [txUpdateTable]);

  // テストデータ整理: seed キャスト削除＋seed 顧客削除＋卓リセット（owner 想定）。
  // 稼働中(ACTIVE/CHECK)の卓は白紙化せず seed キャストの配置だけ除去する
  // （旧実装は全卓リセットで、営業中の実データ卓・POS伝票まで巻き込む破壊操作だった）。
  const clearSeedData = useCallback<UseSeatingStore['clearSeedData']>(async () => {
    if (!shopId) return;
    const [cs, ts, cu] = await Promise.all([
      getDocs(collection(db, `shop_shops/${shopId}/seating_casts`)),
      getDocs(collection(db, `shop_shops/${shopId}/seating_tables`)),
      getDocs(query(collection(db, `shop_shops/${shopId}/customers`), where('seed', '==', true))),
    ]);
    const seedCastIds = new Set<string>();
    cs.forEach((d) => { if ((d.data() as { seed?: boolean }).seed === true) seedCastIds.add(d.id); });
    const batch = writeBatch(db);
    seedCastIds.forEach((id) => batch.delete(doc(db, `shop_shops/${shopId}/seating_casts/${id}`)));
    cu.forEach((d) => batch.delete(d.ref));
    ts.forEach((d) => {
      const t = toFloorTable(d.id, d.data() as Partial<FloorTable>);
      if (t.status === 'ACTIVE' || t.status === 'CHECK') {
        // 稼働卓: seed キャストの配置のみ除去（客・伝票・タイマーは保持）
        let patch: TablePatch = {};
        for (const id of seedCastIds) {
          const merged = { ...t, ...patch } as FloorTable;
          const p = removeCastPatch(merged, id);
          patch = { ...patch, ...p };
        }
        if (Object.keys(patch).length > 0) batch.update(d.ref, { ...patch, updatedAt: serverTimestamp() });
      } else {
        batch.set(d.ref, { ...createEmptyTable(t.id, t.name), slips: [], updatedAt: serverTimestamp() });
      }
    });
    await batch.commit();
  }, [shopId]);

  const setTableType = useCallback<UseSeatingStore['setTableType']>(async (tableId, type) => {
    await txUpdateTable(tableId, () => ({ type }));
  }, [txUpdateTable]);

  const checkTable = useCallback<UseSeatingStore['checkTable']>(async (tableId) => {
    // ACTIVE⇄CHECK のトグル（誤タップの会計を解除できる。空卓は不変）
    await txUpdateTable(tableId, (t) => {
      if (t.status === 'ACTIVE') return { status: 'CHECK' };
      if (t.status === 'CHECK') return { status: 'ACTIVE' };
      return null;
    });
  }, [txUpdateTable]);

  const extendTime = useCallback<UseSeatingStore['extendTime']>(async (tableId, minutes) => {
    // 延長はセット長(setTimeLength)を変えず extraMinutes に積む。
    // 旧実装は setTimeLength 本体を加算→以降の全セットが恒久的に伸び料金/セット数がずれるバグだった。
    await txUpdateTable(tableId, (t) => ({ extraMinutes: Math.max(0, t.extraMinutes ?? 0) + minutes }));
  }, [txUpdateTable]);

  const toggleInnerRotation = useCallback<UseSeatingStore['toggleInnerRotation']>(async (tableId) => {
    await txUpdateTable(tableId, (t) => ({ innerRotationEnabled: !t.innerRotationEnabled }));
  }, [txUpdateTable]);

  const resetTable = useCallback<UseSeatingStore['resetTable']>(async (tableId) => {
    if (!shopId) return null;
    // 退店：最新の卓設定（セット長/ローテ設定・卓名）だけ引き継ぎ、状態と POS 伝票(slips)を空へ。
    // 誤操作アンドゥ用にリセット直前のデータを返す。
    let snapshot: Partial<FloorTable> | null = null;
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const raw = snap.data() as Partial<FloorTable>;
      const t = toFloorTable(tableId, raw);
      snapshot = JSON.parse(JSON.stringify(raw)); // serverTimestamp 等を含まない plain copy
      // merge なしの全置換＝本当の白紙化（merge だと castStartTimes 等のマップに
      // ghost キーが残り、entryNumber 等の残骸も消えない）
      tx.set(ref, {
        ...createEmptyTable(t.id, t.name),
        setTimeLength: t.setTimeLength, rotationTimeLength: t.rotationTimeLength,
        innerRotationEnabled: t.innerRotationEnabled,
        slips: [], updatedAt: serverTimestamp(),
      });
    });
    return snapshot;
  }, [shopId, tableRef]);

  const restoreTable = useCallback<UseSeatingStore['restoreTable']>(async (tableId, snapshot) => {
    if (!shopId) return;
    // アンドゥは「まだ空席のまま」のときだけ（次の来店が始まった卓を巻き戻さない）
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('卓が見つかりません');
      const cur = toFloorTable(tableId, snap.data() as Partial<FloorTable>);
      if (cur.status !== 'EMPTY') throw new Error(`この卓は既に使用中のため元に戻せません（${cur.name}）`);
      const clean = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
      delete clean.updatedAt; // 旧タイムスタンプ型の混入を避ける
      tx.set(ref, { ...clean, updatedAt: serverTimestamp() }, { merge: true });
    });
  }, [shopId, tableRef]);

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
    if (!shopId) return;
    // 案内＋待ち組削除を単一トランザクションに。
    // （2端末が同じ待ち組を同時に案内しても、先勝ちで後手は no-op＝二重案内を防ぐ）
    const now = Date.now();
    const todayKey = businessDayKey();
    const queueR = doc(db, `shop_shops/${shopId}/seating_queue/${item.id}`);
    const metaR = doc(db, `shop_shops/${shopId}/seating_meta/state`);
    await runTransaction(db, async (tx) => {
      const queueSnap = await tx.get(queueR);
      if (!queueSnap.exists()) return; // 既に別端末が案内済み
      const tableSnap = await tx.get(tableRef(tableId));
      if (!tableSnap.exists()) throw new Error('卓が見つかりません');
      const t = toFloorTable(tableId, tableSnap.data() as Partial<FloorTable>);
      if (!canStartSet(t.status)) throw new Error(`この卓は使用中です（${t.name}）`);
      const metaSnap = await tx.get(metaR);
      const meta = metaSnap.exists() ? (metaSnap.data() as { dailySequence?: number; dayKey?: string }) : undefined;
      const seq = nextDailySequence(meta, todayKey);
      const customers: Customer[] = Array.from({ length: Math.max(1, item.groupSize) }, (_, i) => ({
        id: `cust_${now}_${i}`, name: i === 0 ? item.name : undefined, type: item.type, entryTime: now,
      }));
      // 新しい来店＝着席時刻は現在着席中のキャストのみ引き継ぐ（過去来店の ghost を一掃）
      const castStartTimes = pruneCastStartTimes(t.castStartTimes, t.currentHostIds);
      (t.currentHostIds ?? []).forEach((cid) => { if (!castStartTimes[cid]) castStartTimes[cid] = now; });
      tx.set(metaR, { dailySequence: seq, dayKey: todayKey, updatedAt: serverTimestamp() }, { merge: true });
      tx.update(tableRef(tableId), {
        status: 'ACTIVE', startTime: now, entryTime: now, entryNumber: seq,
        type: item.type,
        customers: customers.map((c) => ({ ...c })),
        extraMinutes: 0, // 新しい来店＝延長リセット
        sessionLog: [], // 回し履歴も来店単位でリセット
        castStartTimes, updatedAt: serverTimestamp(),
      });
      tx.delete(queueR);
    });
  }, [shopId, tableRef]);

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId, canManage: shop.canManage, isDevice: shop.isDevice, error: shop.error,
    dataError,
    casts, tables, queue, rotationOrder, setRotationOrder,
    addCast, updateCast, removeCast, toggleLock, setCastBaseStatus,
    seedTables, seedTestData, assignCast, removeCastFromTable, toggleMainHost, toggleRequested, rotateHosts,
    startSet, setTableType, checkTable, extendTime, toggleInnerRotation, updateTableSettings, setCastExcluded, clearSeedData, resetTable, restoreTable,
    addToQueue, removeFromQueue, seatQueueGroup,
  }), [
    shop.loading, loadingData, shopId, shop.canManage, shop.isDevice, shop.error, dataError, casts, tables, queue, rotationOrder, setRotationOrder,
    addCast, updateCast, removeCast, toggleLock, setCastBaseStatus,
    seedTables, seedTestData, assignCast, removeCastFromTable, toggleMainHost, toggleRequested, rotateHosts,
    startSet, setTableType, checkTable, extendTime, toggleInnerRotation, updateTableSettings, setCastExcluded, clearSeedData, resetTable, restoreTable,
    addToQueue, removeFromQueue, seatQueueGroup,
  ]);
}
