'use client';

/**
 * useShopId に店舗ロール（members/{uid}.role）を加えた共通フック。
 * UI の権限ゲートを「オーナーのみ(canManage)」から役割ベースへ広げる用途
 * （リスク管理・未収・給与確定など。rules 側の許可と揃えること）。
 */
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useShopId, type ShopId } from '@/lib/useShopId';

export type ShopRoleCtx = ShopId & {
  /** members/{uid}.role（owner/manager/cast/accounting）。オーナーは members 不在でも 'owner' */
  role: string | null;
  /** role の解決が完了したか（loading とは別。ゲート判定は roleReady 後に行う） */
  roleReady: boolean;
};

export function useShopRole(user: User): ShopRoleCtx {
  const shop = useShopId(user);
  // 非同期取得した member role（shopId とペアで持ち、店舗切替時の取り違えを防ぐ）
  const [fetched, setFetched] = useState<{ shopId: string; role: string | null } | null>(null);

  useEffect(() => {
    // オーナー/未解決時は取得不要（派生値でカバー）。setState は必ず非同期コールバック内で行う
    if (shop.loading || !shop.shopId || shop.canManage) return;
    const sid = shop.shopId;
    let alive = true;
    getDoc(doc(db, `shop_shops/${sid}/members/${user.uid}`))
      .then((s) => { if (alive) setFetched({ shopId: sid, role: s.exists() ? ((s.data() as { role?: string }).role ?? null) : null }); })
      .catch(() => { if (alive) setFetched({ shopId: sid, role: null }); });
    return () => { alive = false; };
  }, [shop.loading, shop.shopId, shop.canManage, user.uid]);

  const role = shop.canManage
    ? 'owner'
    : (shop.shopId && fetched?.shopId === shop.shopId ? fetched.role : null);
  const roleReady = !shop.loading
    && (!shop.shopId || shop.canManage || fetched?.shopId === shop.shopId);

  return { ...shop, role, roleReady };
}

/** 指定ロールのいずれかを持つか（オーナーは常に true） */
export function hasShopRole(ctx: ShopRoleCtx, roles: string[]): boolean {
  if (ctx.canManage) return true;
  return ctx.role !== null && roles.includes(ctx.role);
}
