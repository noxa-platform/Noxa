'use client';

/**
 * 店舗カスタム設定レイヤー（DBは固定・設定だけ shop_shops/{id}/config/settings に集約）。
 * 各モジュールはハードコードをやめてここを読む：
 *   - terminology … 用語辞書（キャスト/指名/卓 等の呼称・上書き）
 *   - roles       … 役職＋既定時給（キャストrankのハードコード解消）
 *   - modules     … モジュールの有効/並び/表示名
 *   - salesAttribution … 売上の付け方（担当キャスト or 操作者）
 * 料金/税/メニュー/卓名は既存の pos_config（POS設定）で編集（卓は seating_tables 単一の正）。
 */
import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId } from '@/lib/useShopId';

export type ModuleCfg = { key: string; enabled: boolean; label?: string };
export type RoleWage = { name: string; wage: number };
export type SalesAttribution = 'mainCast' | 'operator';

export type ShopConfig = {
  terminology: Record<string, string>;
  roles: RoleWage[];
  modules: ModuleCfg[];
  salesAttribution: SalesAttribution;
};

/** モジュール既定（key は route の slug。NAV_STORE と一致させる） */
export const DEFAULT_MODULES: { key: string; label: string }[] = [
  { key: 'pos', label: 'POS' },
  { key: 'seating', label: '席回し' },
  { key: 'attendance', label: '勤怠' },
  { key: 'payroll', label: '給与' },
  { key: 'first-visit', label: '初回案内' },
  { key: 'transport', label: '送迎' },
  { key: 'inventory', label: '在庫' },
  { key: 'trial', label: '体験入店' },
  { key: 'reservation', label: '予約' },
  { key: 'unpaid', label: '売掛管理' },
  { key: 'risk', label: 'リスク客共有' },
];

export const DEFAULT_ROLES: RoleWage[] = [
  { name: 'BOSS', wage: 10000 },
  { name: '役職', wage: 8000 },
  { name: '非役職', wage: 5000 },
  { name: '新人', wage: 3000 },
];

/** 用語キーの既定（夜職一般） */
export const DEFAULT_TERMS: Record<string, string> = {
  cast: 'キャスト',
  nomination: '指名',
  displayName: '源氏名',
  table: '卓',
  checkout: '会計',
  customer: 'お客様',
};

/** 業種プリセット（storeTypeName → 用語上書き） */
export const INDUSTRY_TERMS: Record<string, Record<string, string>> = {
  ホストクラブ: { cast: 'ホスト', nomination: '本指名' },
  コンカフェ: { cast: 'キャスト', nomination: '推し', displayName: 'キャラ名', table: '席', checkout: 'お会計' },
  ガールズバー: { cast: 'キャスト', table: '席' },
  スナック: { cast: 'ママ・キャスト', table: '席' },
};

export const DEFAULT_CONFIG: ShopConfig = {
  terminology: {},
  roles: DEFAULT_ROLES,
  modules: DEFAULT_MODULES.map((m) => ({ key: m.key, enabled: true })),
  salesAttribution: 'mainCast',
};

/** 用語解決: 店舗上書き → 業種プリセット → 既定 → key */
export function resolveTerm(config: ShopConfig | null, industry: string | undefined, key: string): string {
  return config?.terminology?.[key]
    ?? (industry ? INDUSTRY_TERMS[industry]?.[key] : undefined)
    ?? DEFAULT_TERMS[key]
    ?? key;
}

/** モジュール構成を既定とマージ（未知/新規モジュールは末尾に有効で補完） */
export function mergeModules(cfg: ModuleCfg[] | undefined): ModuleCfg[] {
  const out: ModuleCfg[] = [];
  const seen = new Set<string>();
  for (const m of cfg ?? []) {
    if (DEFAULT_MODULES.some((d) => d.key === m.key)) { out.push(m); seen.add(m.key); }
  }
  for (const d of DEFAULT_MODULES) if (!seen.has(d.key)) out.push({ key: d.key, enabled: true });
  return out;
}

export type UseShopConfig = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;
  config: ShopConfig;
  save: (patch: Partial<ShopConfig>) => Promise<void>;
};

export function useShopConfig(user: User): UseShopConfig {
  const shop = useShopId(user);
  const [config, setConfig] = useState<ShopConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (shop.loading || !shop.shopId) { if (!shop.loading) setLoaded(true); return; }
    const ref = doc(db, `shop_shops/${shop.shopId}/config/settings`);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.exists() ? (snap.data() as Partial<ShopConfig>) : {};
      setConfig({
        terminology: d.terminology ?? {},
        roles: d.roles?.length ? d.roles : DEFAULT_ROLES,
        modules: mergeModules(d.modules),
        salesAttribution: d.salesAttribution ?? 'mainCast',
      });
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, [shop.loading, shop.shopId]);

  const save = useCallback(async (patch: Partial<ShopConfig>) => {
    if (!shop.shopId) return;
    await setDoc(doc(db, `shop_shops/${shop.shopId}/config/settings`), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  }, [shop.shopId]);

  return { loading: shop.loading || !loaded, shopId: shop.shopId, canManage: shop.canManage, config, save };
}
