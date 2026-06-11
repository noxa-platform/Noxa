'use client';

/**
 * 初回案内（メニュー/指名タブレット）の Firestore ストア。
 * - パネル本体: shop_shops/{shopId}/seating_casts（席回しと共有・メニュー拡張フィールド付き）
 * - 画像: shop_shops/{shopId}/menu_images/{panelId} = { dataUrl }
 * - 情報カード: shop_shops/{shopId}/menu_info_cards/{id}
 * - 指名オーダー: shop_shops/{shopId}/menu_orders/{id}（確定時に seating_tables へ連携）
 * - 表示設定: shop_shops/{shopId}/menu_config/main
 * すべて onSnapshot でリアルタイム共有。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';
import {
  DEFAULT_MENU_CONFIG, type InfoCard, type MenuColor, type MenuConfig, type MenuOrder,
  type MenuOrderCast, type MenuPanel,
} from './types';

type RawCast = DocumentData & {
  id: string; name?: string; rank?: string; ruby?: string; title?: string;
  isNewFace?: boolean; selectable?: boolean; menuVisible?: boolean; menuOrder?: number;
  imgX?: number; imgY?: number; imgScale?: number; createdAt?: { seconds?: number };
};

export type ShopTable = { id: string; name: string };

export type UseMenuStore = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;   // オーナー（設定/PIN 管理）
  isDevice: boolean;
  panels: MenuPanel[];          // 表示順ソート済み（visible 含む全件）
  visiblePanels: MenuPanel[];   // visible のみ（タブレット用）
  tables: ShopTable[];
  orders: MenuOrder[];
  config: MenuConfig;
  // パネル（キャスト）操作
  addCastPanel: (v: { name: string; ruby?: string; title?: string }) => Promise<string>;
  savePanelMeta: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removePanel: (id: string) => Promise<void>;
  setPanelImage: (id: string, dataUrl: string) => Promise<void>;
  reorderPanel: (id: string, dir: -1 | 1) => Promise<void>;
  // 情報カード
  addInfoCard: (label: string) => Promise<string>;
  // 指名オーダー
  submitOrders: (groups: { color: MenuColor; casts: MenuOrderCast[]; seat: string; customerName: string; memo: string }[], source: string) => Promise<void>;
  updateOrder: (id: string, patch: Partial<Pick<MenuOrder, 'seat' | 'customerName' | 'memo'>>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  clearOrders: () => Promise<void>;
  // 設定 / PIN
  saveConfig: (patch: Partial<MenuConfig>) => Promise<void>;
  setPanelPin: (pin: string) => Promise<void>;
};

async function sha256Hex(shopId: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${shopId}:${pin}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toMs(v: unknown): number {
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) return ((v as { seconds: number }).seconds) * 1000;
  if (typeof v === 'number') return v;
  return 0;
}

export function useMenuStore(user: User): UseMenuStore {
  const shop = useShopId(user);
  const shopId = shop.shopId;

  const [casts, setCasts] = useState<RawCast[]>([]);
  const [infoCards, setInfoCards] = useState<InfoCard[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<MenuOrder[]>([]);
  const [tables, setTables] = useState<ShopTable[]>([]);
  const [tableDocs, setTableDocs] = useState<Record<string, DocumentData>>({});
  const [config, setConfig] = useState<MenuConfig>(DEFAULT_MENU_CONFIG);
  const [subsReady, setSubsReady] = useState(false);

  useEffect(() => {
    if (shop.loading || !shopId) return;
    const base = `shop_shops/${shopId}`;
    const unsubs = [
      onSnapshot(collection(db, `${base}/seating_casts`), (snap) => {
        const list: RawCast[] = []; snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
        setCasts(list);
      }),
      onSnapshot(collection(db, `${base}/menu_info_cards`), (snap) => {
        const list: InfoCard[] = []; snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<InfoCard, 'id'>) }));
        setInfoCards(list);
      }),
      onSnapshot(collection(db, `${base}/menu_images`), (snap) => {
        const m: Record<string, string> = {}; snap.forEach((d) => { const v = d.data() as { dataUrl?: string }; if (v.dataUrl) m[d.id] = v.dataUrl; });
        setImages(m);
      }),
      onSnapshot(collection(db, `${base}/menu_orders`), (snap) => {
        const list: MenuOrder[] = [];
        snap.forEach((d) => {
          const v = d.data() as DocumentData;
          list.push({
            id: d.id, seat: v.seat ?? '', tableId: v.tableId ?? null, customerName: v.customerName ?? '',
            memo: v.memo ?? '', color: (v.color ?? 'yellow') as MenuColor,
            casts: Array.isArray(v.casts) ? (v.casts as MenuOrderCast[]) : [],
            source: v.source ?? 'main', createdAtMs: toMs(v.createdAt),
          });
        });
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setOrders(list);
      }),
      onSnapshot(collection(db, `${base}/seating_tables`), (snap) => {
        const t: ShopTable[] = []; const docs: Record<string, DocumentData> = {};
        snap.forEach((d) => { const v = d.data() as DocumentData; t.push({ id: d.id, name: (v.name as string) ?? d.id }); docs[d.id] = v; });
        t.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        setTables(t); setTableDocs(docs);
      }),
      onSnapshot(doc(db, `${base}/menu_config/main`), (d) => {
        setConfig(d.exists() ? { ...DEFAULT_MENU_CONFIG, ...(d.data() as Partial<MenuConfig>) } : DEFAULT_MENU_CONFIG);
      }),
    ];
    setSubsReady(true);
    return () => { unsubs.forEach((u) => u()); setSubsReady(false); };
  }, [shop.loading, shopId]);

  // パネル合成（cast + info）→ 表示順ソート
  const panels = useMemo<MenuPanel[]>(() => {
    const castPanels: MenuPanel[] = casts.map((c, i) => ({
      id: c.id, kind: 'cast', name: c.name ?? '', ruby: c.ruby ?? '', title: c.title ?? '',
      label: '', isNewFace: c.isNewFace ?? c.rank === '新人', selectable: c.selectable !== false,
      visible: c.menuVisible !== false, order: c.menuOrder ?? (1000 + i),
      imgX: c.imgX ?? 50, imgY: c.imgY ?? 50, imgScale: c.imgScale ?? 100, image: images[c.id] ?? '',
    }));
    const infoPanels: MenuPanel[] = infoCards.map((c, i) => ({
      id: c.id, kind: 'info', name: '', ruby: '', title: '', label: c.label ?? '',
      isNewFace: false, selectable: false, visible: c.menuVisible !== false, order: c.menuOrder ?? (2000 + i),
      imgX: c.imgX ?? 50, imgY: c.imgY ?? 50, imgScale: c.imgScale ?? 100, image: images[c.id] ?? '',
    }));
    return [...castPanels, ...infoPanels].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'));
  }, [casts, infoCards, images]);

  const visiblePanels = useMemo(() => panels.filter((p) => p.visible), [panels]);

  const castCol = useCallback(() => collection(db, `shop_shops/${shopId}/seating_casts`), [shopId]);

  const addCastPanel = useCallback<UseMenuStore['addCastPanel']>(async (v) => {
    if (!shopId) return '';
    const maxOrder = panels.reduce((m, p) => Math.max(m, p.order), 0);
    const ref = await addDoc(castCol(), {
      name: v.name, ruby: v.ruby ?? '', title: v.title ?? '',
      rank: '非役職', hourlyWage: 0, isLocked: false, baseStatus: 'Free',
      isNewFace: false, selectable: true, menuVisible: true, menuOrder: maxOrder + 1,
      imgX: 50, imgY: 50, imgScale: 100, createdAt: serverTimestamp(),
    });
    return ref.id;
  }, [shopId, panels, castCol]);

  const savePanelMeta = useCallback<UseMenuStore['savePanelMeta']>(async (id, patch) => {
    if (!shopId) return;
    const p = panels.find((x) => x.id === id);
    const col = p?.kind === 'info' ? 'menu_info_cards' : 'seating_casts';
    await updateDoc(doc(db, `shop_shops/${shopId}/${col}/${id}`), patch);
  }, [shopId, panels]);

  const removePanel = useCallback<UseMenuStore['removePanel']>(async (id) => {
    if (!shopId) return;
    const p = panels.find((x) => x.id === id);
    const col = p?.kind === 'info' ? 'menu_info_cards' : 'seating_casts';
    await deleteDoc(doc(db, `shop_shops/${shopId}/${col}/${id}`));
    await deleteDoc(doc(db, `shop_shops/${shopId}/menu_images/${id}`)).catch(() => {});
  }, [shopId, panels]);

  const setPanelImage = useCallback<UseMenuStore['setPanelImage']>(async (id, dataUrl) => {
    if (!shopId) return;
    await setDoc(doc(db, `shop_shops/${shopId}/menu_images/${id}`), { dataUrl, updatedAt: serverTimestamp() });
  }, [shopId]);

  const reorderPanel = useCallback<UseMenuStore['reorderPanel']>(async (id, dir) => {
    if (!shopId) return;
    const idx = panels.findIndex((p) => p.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= panels.length) return;
    const a = panels[idx]; const b = panels[swapIdx];
    await savePanelMeta(a.id, { menuOrder: b.order });
    await savePanelMeta(b.id, { menuOrder: a.order });
  }, [shopId, panels, savePanelMeta]);

  const addInfoCard = useCallback<UseMenuStore['addInfoCard']>(async (label) => {
    if (!shopId) return '';
    const maxOrder = panels.reduce((m, p) => Math.max(m, p.order), 0);
    const ref = await addDoc(collection(db, `shop_shops/${shopId}/menu_info_cards`), {
      label, menuVisible: true, menuOrder: maxOrder + 1, imgX: 50, imgY: 50, imgScale: 100, createdAt: serverTimestamp(),
    });
    return ref.id;
  }, [shopId, panels]);

  const submitOrders = useCallback<UseMenuStore['submitOrders']>(async (groups, source) => {
    if (!shopId) return;
    const now = Date.now();
    for (const g of groups) {
      const table = tables.find((t) => t.name === g.seat);
      await addDoc(collection(db, `shop_shops/${shopId}/menu_orders`), {
        seat: g.seat, tableId: table?.id ?? null, customerName: g.customerName, memo: g.memo,
        color: g.color, casts: g.casts, source, createdAt: serverTimestamp(),
      });
      // 席回し連携: 選ばれたキャストを指名(requested)＋現着に反映。
      // 表示パネルのうち選ばれなかったキャストはこの卓の除外(excluded)に入れ、ローテ／AI候補から外す。
      if (table) {
        const tdoc = tableDocs[table.id] ?? {};
        const cur: string[] = Array.isArray(tdoc.currentHostIds) ? tdoc.currentHostIds : [];
        const hist: string[] = Array.isArray(tdoc.assignedHistory) ? tdoc.assignedHistory : [];
        const req: string[] = Array.isArray(tdoc.requestedHostIds) ? tdoc.requestedHostIds : [];
        const prevEx: string[] = Array.isArray(tdoc.excludedHostIds) ? tdoc.excludedHostIds : [];
        const starts: Record<string, number> = (tdoc.castStartTimes as Record<string, number>) ?? {};
        const ids = g.casts.map((c) => c.id);
        const nextCur = Array.from(new Set([...cur, ...ids]));
        const nextHist = Array.from(new Set([...hist, ...ids]));
        const nextReq = Array.from(new Set([...req, ...ids]));
        // 候補プール（表示中のキャストパネル）から未選択を除外に追加。選択された人は除外から外す。
        const pool = visiblePanels.filter((p) => p.kind !== 'info').map((p) => p.id);
        const nextEx = Array.from(new Set([...prevEx, ...pool.filter((id) => !ids.includes(id))])).filter((id) => !ids.includes(id));
        for (const id of ids) if (!starts[id]) starts[id] = now;
        // 空席卓に指名が入ったら開卓（席回しが ACTIVE で表示され、残り時間カウントも開始）
        const wasEmpty = !tdoc.status || tdoc.status === 'EMPTY';
        await setDoc(doc(db, `shop_shops/${shopId}/seating_tables/${table.id}`), {
          currentHostIds: nextCur, requestedHostIds: nextReq, excludedHostIds: nextEx,
          assignedHistory: nextHist, castStartTimes: starts, updatedAt: serverTimestamp(),
          ...(wasEmpty ? { status: 'ACTIVE', startTime: now, entryTime: now } : {}),
        }, { merge: true });
      }
    }
  }, [shopId, tables, tableDocs, visiblePanels]);

  const updateOrder = useCallback<UseMenuStore['updateOrder']>(async (id, patch) => {
    if (!shopId) return;
    await updateDoc(doc(db, `shop_shops/${shopId}/menu_orders/${id}`), patch);
  }, [shopId]);
  const deleteOrder = useCallback<UseMenuStore['deleteOrder']>(async (id) => {
    if (!shopId) return;
    await deleteDoc(doc(db, `shop_shops/${shopId}/menu_orders/${id}`));
  }, [shopId]);
  const clearOrders = useCallback<UseMenuStore['clearOrders']>(async () => {
    if (!shopId) return;
    await Promise.all(orders.map((o) => deleteDoc(doc(db, `shop_shops/${shopId}/menu_orders/${o.id}`))));
  }, [shopId, orders]);

  const saveConfig = useCallback<UseMenuStore['saveConfig']>(async (patch) => {
    if (!shopId) return;
    await setDoc(doc(db, `shop_shops/${shopId}/menu_config/main`), patch, { merge: true });
  }, [shopId]);

  const setPanelPin = useCallback<UseMenuStore['setPanelPin']>(async (pin) => {
    if (!shopId) return;
    const pinHash = await sha256Hex(shopId, pin);
    await setDoc(doc(db, `shop_shops/${shopId}/device_profiles/panel`), {
      label: '初回案内パネル', allowedModules: ['first-visit'], pinHash, updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [shopId]);

  return {
    loading: shop.loading || (!!shopId && !subsReady),
    shopId, canManage: shop.canManage, isDevice: shop.isDevice,
    panels, visiblePanels, tables, orders, config,
    addCastPanel, savePanelMeta, removePanel, setPanelImage, reorderPanel, addInfoCard,
    submitOrders, updateOrder, deleteOrder, clearOrders, saveConfig, setPanelPin,
  };
}
