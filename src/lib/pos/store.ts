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
import { getActiveShop } from '@/lib/workspace';
import { resolveShopIdState, SHOP_UNRESOLVED_TEXT } from '@/lib/shop-id-state';
import { activeMembershipIds } from '@/lib/membership';
import { describeFirestoreError } from '@/lib/firestore-error';
import { useOperationError } from '@/lib/operation-error';
import {
  APPLIED, UNCHANGED, assertWriteApplied, describeMissingWrite, missing, type WriteOutcome,
} from '@/lib/write-outcome';
import type { StoreConfig } from './types';
import { createDefaultStoreConfig } from './defaultConfig';
import {
  calculatorReducer, calculateResult, createInitialState, createPinnedOrders,
  type Action, type CalculatorState, type CalculationResult, type CustomerType, type PosSlip,
} from './engine';
import type { FloorTable, Cast } from '@/lib/seating/types';
import { createEmptyTable } from '@/lib/seating/types';
import { resolveSaleAttribution } from './attribution';
import { buildUnpaidEntry } from './unpaid';

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

/**
 * 伝票一覧の中の 1 枚を差し替える（純関数・Day124）。
 *
 * **対象が一覧に無ければ書き込みを作らず `missing('slip')` を返す**のが要点。
 * 旧実装は「見つからなければそのまま」で、他端末が先に会計・破棄した伝票への注文追加が
 * 黙って消え、しかも成功として表示されていた（ボトル 1 本＝売上がまるごと落ちる）。
 * `fn` が null を返した場合は削除＝適用済み（伝票は消えるが「書いた」ので成功）。
 */
export function replaceSlipInList(
  slips: PosSlip[],
  slipId: string,
  fn: (s: PosSlip) => PosSlip | null,
): { slips: PosSlip[] } | WriteOutcome {
  if (!slips.some((s) => s.id === slipId)) return missing('slip');
  const next: PosSlip[] = [];
  for (const s of slips) {
    if (s.id !== slipId) { next.push(s); continue; }
    const r = fn(s);
    if (r) next.push(r);
  }
  return { slips: next };
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
      // 読み取りは独立させ、失敗を「未所属」と混ぜない（Day109・shop-id-state.ts）
      let failure: string | null = null;
      const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)))
        .then((snap) => snap.docs.map((d) => d.id))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`))
        .then((snap) => activeMembershipIds(snap.docs))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      if (!alive) return;
      const st = resolveShopIdState({ owned, memberships: ms, active: getActiveShop() });
      setCtx({
        loading: false, shopId: st.shopId, canConfig: st.isOwner, isDevice: false,
        error: st.unresolved ? (failure ?? SHOP_UNRESOLVED_TEXT) : null,
      });
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
  /** 料金設定（pos_config）の読み取り失敗。**既定料金で会計させない**ための理由・Day110 */
  configError: string | null;
  /** 卓/担当/顧客の購読に失敗した理由（空表示＝未設定と区別する・Day115） */
  dataError: string | null;
  /**
   * 直近の**操作（書き込み）**の失敗（Day117）。
   * 注文追加や伝票操作は JSX から投げっぱなしで呼ばれるため、ここへ集約して画面に出す。
   */
  opError: string | null;
  clearOpError: () => void;
  config: StoreConfig;
  tables: FloorTable[];
  casts: Cast[];
  customers: ShopCustomer[];
  needsSeed: boolean;
  seedTables: () => Promise<boolean>;
  addSlip: (tableId: string, init?: { customerType?: CustomerType; initialSetPrice?: number; entryTime?: string; dohan?: boolean; castName?: string; castUid?: string; castId?: string; customerName?: string; customerId?: string }) => Promise<boolean>;
  dispatchSlip: (tableId: string, slipId: string, action: Action) => Promise<boolean>;
  renameSlip: (tableId: string, slipId: string, name: string) => Promise<boolean>;
  removeSlip: (tableId: string, slipId: string) => Promise<boolean>;
  checkoutSlip: (tableId: string, slipId: string, opts: { amount: number; castName?: string; customerName?: string; guests?: number; unpaidAmount?: number }) => Promise<boolean>;
  resultFor: (slip: PosSlip) => CalculationResult;
};

/**
 * 包む前の生の実装の型（Day117）。公開 API は `guard()` で包んで成功可否を boolean で返すが、
 * 実装側は失敗を throw する素の関数のまま書く。
 */
type RawPosOp<T> = T extends (...args: infer A) => Promise<unknown> ? (...args: A) => Promise<void> : never;

export function usePosStore(user: User): UsePosStore {
  const shop = usePosShop(user);
  const shopId = shop.shopId;
  // 書き込みの失敗を1本にまとめて画面へ渡す（Day117）
  const { opError, clearOpError, run } = useOperationError();

  const [config, setConfig] = useState<StoreConfig>(() => createDefaultStoreConfig());
  // 料金設定の読み取り失敗（既定料金での会計を止めるための理由・Day110）
  const [configError, setConfigError] = useState<string | null>(null);
  /**
   * 卓/キャスト/顧客の**購読**に失敗した理由（Day115）。
   * 旧実装は卓を空リスト確定、キャストを console.warn、顧客を完全握り潰しにしており、
   * 権限エラーや通信断でも「卓が無い・担当が居ない・顧客が居ない」＝**未設定と同じ表示**になっていた
   * （POS は会計中に触るので、担当を選べない理由が分からないまま会計が進む）。
   */
  const [dataError, setDataError] = useState<string | null>(null);
  // 卓は出所（shopId）つきで保持し loading を導出（Day17: set-state-in-effect 返済・seating store と同型）
  const [tablesSnap, setTablesSnap] = useState<{ shopId: string; list: FloorTable[] } | null>(null);
  const [casts, setCasts] = useState<Cast[]>([]);
  const [customers, setCustomers] = useState<ShopCustomer[]>([]);
  const tables = useMemo(
    () => (shopId && tablesSnap?.shopId === shopId ? tablesSnap.list : []),
    [shopId, tablesSnap],
  );
  const loadingData = !!shopId && tablesSnap?.shopId !== shopId;
  const configRef = useRef(config);
  // 売上の付け方（店舗設定 config/settings.salesAttribution）。会計時の帰属に使用
  const attributionRef = useRef<'mainCast' | 'operator'>('mainCast');

  // 店舗設定（売上の付け方）を購読
  useEffect(() => {
    if (!shopId) return;
    const unsub = onSnapshot(doc(db, `shop_shops/${shopId}/config/settings`), (snap) => {
      const a = snap.exists() ? (snap.data() as { salesAttribution?: string }).salesAttribution : undefined;
      attributionRef.current = a === 'operator' ? 'operator' : 'mainCast';
      // 売上の付け方（担当 or 記録者）が読めないまま既定 mainCast で会計すると、
      // **誰の売上になるかが静かに変わる**（給与・成績まで波及する・Day115）
    }, (e) => setDataError(describeFirestoreError(e, '売上の付け方（店舗設定）の読み込み')));
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
        setConfigError(null);
        if (snap.exists()) {
          setConfig({ ...createDefaultStoreConfig('active'), ...(snap.data() as Partial<StoreConfig>) } as StoreConfig);
        } else if (shop.canConfig) {
          const seed = createDefaultStoreConfig('active');
          await setDoc(ref, { ...seed, updatedAt: serverTimestamp() });
          if (alive) setConfig(seed);
        } else {
          setConfig(createDefaultStoreConfig('active'));
        }
      } catch (e) {
        // 既定料金で会計を続けると**間違った金額で伝票を切り、その額が売上として記録される**。
        // 画面側が会計を止められるよう理由を残す（Day110）
        if (alive) { setConfig(createDefaultStoreConfig('active')); setConfigError(describeFirestoreError(e, '料金設定の読み込み')); }
      }
    })();
    return () => { alive = false; };
  }, [shopId, shop.canConfig]);

  // 卓（seating_tables）購読
  useEffect(() => {
    if (!shopId) return;
    const unsubT = onSnapshot(collection(db, `shop_shops/${shopId}/seating_tables`), (snap) => {
      const list: FloorTable[] = [];
      snap.forEach((d) => list.push({ ...createEmptyTable(d.id, d.id), ...(d.data() as Partial<FloorTable>), id: d.id } as FloorTable));
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setTablesSnap({ shopId, list });
    }, (e) => { setTablesSnap({ shopId, list: [] }); setDataError(describeFirestoreError(e, '卓の読み込み')); });
    const unsubC = onSnapshot(collection(db, `shop_shops/${shopId}/seating_casts`), (snap) => {
      const list: Cast[] = [];
      snap.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        list.push({ id: d.id, name: (x.name as string) ?? '?', rank: (x.rank as Cast['rank']) ?? '非役職', hourlyWage: (x.hourlyWage as number) ?? 0, isLocked: !!x.isLocked, status: 'Free', currentTableId: null, uid: (x.uid as string) ?? null });
      });
      setCasts(list);
    }, (e) => setDataError(describeFirestoreError(e, '担当（キャスト）の読み込み')));
    const unsubCust = onSnapshot(collection(db, `shop_shops/${shopId}/customers`), (snap) => {
      const list: ShopCustomer[] = [];
      snap.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        list.push({ id: d.id, name: (x.name as string) ?? '（無名）', mainCastId: (x.mainCastId as string) ?? null, mainCastUid: (x.mainCastUid as string) ?? null });
      });
      setCustomers(list);
    }, (e) => setDataError(describeFirestoreError(e, '顧客の読み込み')));
    return () => { unsubT(); unsubC(); unsubCust(); };
  }, [shopId]);

  // render 中の ref 書込は react-hooks/refs 違反（並行レンダーで巻き戻り得る）→ effect で同期。
  // useRef(config) の初期値があるため、effect 反映前の read も既定 config で安全
  useEffect(() => { configRef.current = config; }, [config]);

  const tableRef = useCallback((id: string) => doc(db, `shop_shops/${shopId}/seating_tables/${id}`), [shopId]);

  const seedTables = useCallback<RawPosOp<UsePosStore['seedTables']>>(async () => {
    if (!shopId) return;
    let names = DEFAULT_TABLE_NAMES;
    try {
      const tn = configRef.current.tableNames;
      if (Array.isArray(tn) && tn.length) names = tn;
    } catch { /* ignore */ }
    // 既存卓は上書きしない（席回し側と同じガード。二度押しで稼働中フロア・伝票を白紙化しない）
    const existing = await getDocs(collection(db, `shop_shops/${shopId}/seating_tables`));
    const existingIds = new Set(existing.docs.map((d) => d.id));
    await Promise.all(names.map((name, i) => {
      const id = `tbl_${i + 1}`;
      if (existingIds.has(id)) return Promise.resolve();
      return setDoc(doc(db, `shop_shops/${shopId}/seating_tables/${id}`), { ...createEmptyTable(id, name), updatedAt: serverTimestamp() });
    }));
  }, [shopId, configRef]);

  // Firestore は undefined を拒否するため、書込前に undefined を除去（JSON 往復）
  // 伝票の読み取り→変更→書き戻しをトランザクションで実行（複数端末の同時編集での消失を防ぐ）。
  // transform はサーバ最新の slips と卓データを受け取り、新 slips と卓への追加更新(extra)を返す。
  const txSlips = useCallback(async (
    tableId: string,
    transform: (slips: PosSlip[], data: DocumentData) => { slips: PosSlip[]; extra?: Record<string, unknown> } | WriteOutcome | null,
  ): Promise<WriteOutcome> => {
    if (!shopId) return UNCHANGED;
    // 「何も書かなかった」を呼び出し側へ返す（Day124）。旧実装は卓が消えていても黙って
    // 正常終了し、run() が成功として扱っていた＝押しても伝票が変わらないのに成功表示。
    let outcome: WriteOutcome = APPLIED;
    await runTransaction(db, async (tx) => {
      outcome = APPLIED; // 競合による再試行で前回の結末を持ち越さない
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      if (!snap.exists()) { outcome = missing('table'); return; }
      const data = snap.data();
      const slips: PosSlip[] = Array.isArray(data.slips) ? (data.slips as PosSlip[]) : [];
      const result = transform(slips, data);
      if (!result) { outcome = UNCHANGED; return; }
      if ('kind' in result) { outcome = result; return; } // transform 側が対象の消失を検出
      const clean = JSON.parse(JSON.stringify(result.slips));
      tx.set(ref, { slips: clean, updatedAt: serverTimestamp(), ...(result.extra ?? {}) }, { merge: true });
    });
    return outcome;
  }, [shopId, tableRef]);

  const addSlip = useCallback<RawPosOp<UsePosStore['addSlip']>>(async (tableId, init) => {
    const cfg = configRef.current;
    const base = createInitialState(cfg);
    const state: CalculatorState = init
      ? { ...base, customerType: init.customerType ?? base.customerType, initialSetPrice: init.initialSetPrice ?? base.initialSetPrice, entryTime: init.entryTime ?? base.entryTime, dohan: init.dohan ?? base.dohan, orders: createPinnedOrders(cfg, init.customerType ?? base.customerType) }
      : base;
    // 整合: castId 未指定でも castName から席回しキャストを解決し、必ず卓に配置する
    const resolvedCastId = init?.castId ?? (init?.castName ? casts.find((c) => c.name === init.castName)?.id : undefined);
    assertWriteApplied(await txSlips(tableId, (slips, data) => {
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
    }));
  }, [configRef, txSlips, casts]);

  /**
   * 伝票 1 枚を書き換える。**対象の伝票がサーバ側に無ければ書かずに missing を返す**
   * （旧実装は「無ければ何もしない」＝注文追加が黙って消えていた・Day124）。
   */
  const mutateSlip = useCallback(async (tableId: string, slipId: string, fn: (s: PosSlip) => PosSlip | null) => {
    return txSlips(tableId, (slips) => replaceSlipInList(slips, slipId, fn));
  }, [txSlips]);

  const dispatchSlip = useCallback<RawPosOp<UsePosStore['dispatchSlip']>>(async (tableId, slipId, action) => {
    assertWriteApplied(await mutateSlip(tableId, slipId, (s) => ({ ...s, state: calculatorReducer(s.state, action, configRef.current) })));
  }, [mutateSlip, configRef]);

  const renameSlip = useCallback<RawPosOp<UsePosStore['renameSlip']>>(async (tableId, slipId, name) => {
    assertWriteApplied(await mutateSlip(tableId, slipId, (s) => ({ ...s, name })));
  }, [mutateSlip]);

  const removeSlip = useCallback<RawPosOp<UsePosStore['removeSlip']>>(async (tableId, slipId) => {
    assertWriteApplied(await mutateSlip(tableId, slipId, () => null));
  }, [mutateSlip]);

  const checkoutSlip = useCallback<RawPosOp<UsePosStore['checkoutSlip']>>(async (tableId, slipId, opts) => {
    if (!shopId) return;
    // 金銭書込の入口ガード（UI 側でも拒否するが、負の売上→顧客累計減算まで波及するため二重防衛）
    if (!Number.isFinite(opts.amount) || opts.amount < 0) throw new Error('会計金額が不正です（0以上を指定してください）');
    // 売上転記＋伝票削除を単一トランザクションで（二重計上/取りこぼし防止・同時編集に安全）
    await runTransaction(db, async (tx) => {
      const ref = tableRef(tableId);
      const snap = await tx.get(ref);
      // 卓が消えていると売上を 1 件も書かずに正常終了し、UI は伝票を閉じていた（Day124）
      if (!snap.exists()) throw new Error(describeMissingWrite('table'));
      const data = snap.data();
      const slips: PosSlip[] = Array.isArray(data.slips) ? (data.slips as PosSlip[]) : [];
      const slip = slips.find((s) => s.id === slipId);
      // 既に会計済み（他端末）等。**黙って成功にしない**——旧実装は売上が増えないまま
      // ok=true を返し、UI が伝票を閉じるため、両方の端末が「会計した」と思っていた。
      // 先に通った会計の金額がこちらと違えば、売上の食い違いに誰も気づけない（Day124）。
      if (!slip) {
        const tableName = (data.name as string) ?? '';
        throw new Error(describeMissingWrite('slip', {
          hint: `${tableName ? `卓「${tableName}」の` : 'この'}伝票は他の端末で先に会計・破棄された可能性があります。二重会計を防ぐため中止しました。売上画面で金額が記録済みかを確認してください。`,
        }));
      }
      // 内訳（注文品目）のスナップショット。会計後も「何を何本」を残すため sales に保存する。
      // count>0 の品目のみ。合計 amount は set/税/指名等を含むため lineItems の和とは一致しない（注文明細のみ）。
      const lineItems = (Array.isArray(slip.state.orders) ? slip.state.orders : [])
        .filter((o) => (o?.count ?? 0) > 0)
        .map((o) => ({ name: o.name, baseName: o.baseName, unitPrice: o.price, count: o.count, amount: o.price * o.count }));
      // 帰属解決（純ロジック）: castUid 未保存の伝票でも castId/castName から名簿の uid を
      // 解決し、担当キャスト本人の個人売上へ正しく帰属させる（旧実装は操作者へ誤帰属）。
      // 本指名/場内/フリーの指名区分・同伴も会計時点で確定して保存する。
      const attr = resolveSaleAttribution({
        mode: attributionRef.current,
        operatorUid: user.uid,
        slip,
        casts,
        overrideCastName: opts.castName,
        mainHostIds: Array.isArray(data.mainHostIds) ? (data.mainHostIds as string[]) : [],
      });
      const saleRef = doc(collection(db, `shop_shops/${shopId}/sales`));
      // ツケ（未収）会計: 同一トランザクションで unpaid 台帳へ起票（二重管理の解消）。
      // 書込権限は rules の owner/manager/accounting のまま。権限の無いロールには UI が入力を出さない
      const unpaidEntry = opts.unpaidAmount && opts.unpaidAmount > 0
        ? buildUnpaidEntry({
            customerName: opts.customerName ?? slip.customerName,
            castName: attr.castName,
            tableName: (data.name as string) ?? '',
            slipName: slip.name,
            totalAmount: opts.amount,
            unpaidAmount: opts.unpaidAmount,
            dayKey: dayKey(),
            saleId: saleRef.id,
            operatorUid: user.uid,
          })
        : null;
      if (unpaidEntry) {
        tx.set(doc(collection(db, `shop_shops/${shopId}/unpaid`)), { ...unpaidEntry, createdAt: serverTimestamp() });
      }
      tx.set(saleRef, {
        ...(unpaidEntry ? { unpaidAmount: unpaidEntry.amount } : {}),
        source: 'pos', entryMode: 'breakdown', amount: opts.amount, tableId, tableName: (data.name as string) ?? '', slipName: slip.name,
        customerType: slip.state.customerType, customerName: opts.customerName ?? slip.customerName ?? null,
        customerId: slip.customerId ?? null,
        castName: attr.castName,
        castUid: attr.castUid,
        castId: attr.castId,
        nomination: attr.nomination,
        dohan: attr.dohan,
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
  }, [shopId, tableRef, user.uid, casts]);

  // render 中に呼ばれるため ref ではなく config を直接参照する。
  // （configRef は effect 同期＝設定変更後の最初の re-render では1世代古く、
  //   ref 更新は再レンダーを起こさないため次の tick まで古い金額が表示されてしまう）
  const resultFor = useCallback<UsePosStore['resultFor']>((slip) => {
    const live: CalculatorState = slip.state.isDebugMode ? slip.state : { ...slip.state, currentTime: nowHHMM() };
    return calculateResult(live, config);
  }, [config]);

  const needsSeed = !loadingData && !!shopId && tables.length === 0;

  return useMemo(() => ({
    loading: shop.loading || loadingData,
    shopId, canConfig: shop.canConfig, isDevice: shop.isDevice, error: shop.error, configError, dataError,
    opError, clearOpError,
    config, tables, casts, customers, needsSeed,
    // 書き込みは guard で包む（失敗は throw せず opError に載せて false を返す・Day117）
    seedTables: () => run('卓の初期作成', () => seedTables()),
    addSlip: (tableId, init) => run('伝票の作成', () => addSlip(tableId, init)),
    dispatchSlip: (tableId, slipId, action) => run('伝票の更新', () => dispatchSlip(tableId, slipId, action)),
    renameSlip: (tableId, slipId, name) => run('伝票名の変更', () => renameSlip(tableId, slipId, name)),
    removeSlip: (tableId, slipId) => run('伝票の破棄', () => removeSlip(tableId, slipId)),
    checkoutSlip: (tableId, slipId, opts) => run('会計', () => checkoutSlip(tableId, slipId, opts)),
    resultFor,
  }), [opError, clearOpError, run, shop.loading, loadingData, shopId, shop.canConfig, shop.isDevice, shop.error, configError, dataError, config, tables, casts, customers, needsSeed, seedTables, addSlip, dispatchSlip, renameSlip, removeSlip, checkoutSlip, resultFor]);
}

let __slipSeq = 0;
function genSlipId(): string {
  __slipSeq += 1;
  return `s_${__slipSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export type { CalculatorState, CalculationResult, Action, CustomerType, PosSlip };
