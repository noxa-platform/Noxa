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
  const [role, setRole] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);

  useEffect(() => {
    if (shop.loading || !shop.shopId) { setRole(null); setRoleReady(!shop.loading); return; }
    if (shop.canManage) { setRole('owner'); setRoleReady(true); return; }
    let alive = true;
    setRoleReady(false);
    getDoc(doc(db, `shop_shops/${shop.shopId}/members/${user.uid}`))
      .then((s) => { if (alive) { setRole(s.exists() ? ((s.data() as { role?: string }).role ?? null) : null); setRoleReady(true); } })
      .catch(() => { if (alive) { setRole(null); setRoleReady(true); } });
    return () => { alive = false; };
  }, [shop.loading, shop.shopId, shop.canManage, user.uid]);

  return { ...shop, role, roleReady };
}

/** 指定ロールのいずれかを持つか（オーナーは常に true） */
export function hasShopRole(ctx: ShopRoleCtx, roles: string[]): boolean {
  if (ctx.canManage) return true;
  return ctx.role !== null && roles.includes(ctx.role);
}
