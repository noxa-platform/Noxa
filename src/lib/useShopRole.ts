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
import { describeFirestoreError } from '@/lib/firestore-error';
import { resolveShopRoleState, hasRole, type FetchedRole } from '@/lib/shop-role-state';

export type ShopRoleCtx = ShopId & {
  /** members/{uid}.role（owner/manager/cast/accounting）。オーナーは members 不在でも 'owner' */
  role: string | null;
  /** role の解決が完了したか（loading とは別。ゲート判定は roleReady 後に行う） */
  roleReady: boolean;
  /**
   * role の**取得に失敗**した場合の理由（Day108）。
   * 取得失敗と「role が本当に無い（members doc 不在）」は意味が違う:
   * 前者で「オーナー専用です」と出すと、**店長/経理が権限を剥奪されたように見える**
   * （通信断やオフライン復帰直後に、売掛・リスク・給与確定の画面が丸ごと閉じる）。
   * 画面側はこの値がある間「権限を確認できませんでした」と案内して再読み込みを促す。
   */
  roleError: string | null;
};

export function useShopRole(user: User): ShopRoleCtx {
  const shop = useShopId(user);
  // 非同期取得した member role（shopId とペアで持ち、店舗切替時の取り違えを防ぐ）
  const [fetched, setFetched] = useState<FetchedRole | null>(null);

  useEffect(() => {
    // オーナー/未解決時は取得不要（派生値でカバー）。setState は必ず非同期コールバック内で行う
    if (shop.loading || !shop.shopId || shop.canManage) return;
    const sid = shop.shopId;
    let alive = true;
    getDoc(doc(db, `shop_shops/${sid}/members/${user.uid}`))
      .then((s) => { if (alive) setFetched({ shopId: sid, role: s.exists() ? ((s.data() as { role?: string }).role ?? null) : null }); })
      // 取得失敗を role=null（＝権限なし）と同一視しない。roleError として区別する
      // （UI が「オーナー専用」と誤って言い切るのを防ぐ。権限を広げるわけではない）
      .catch((e) => { if (alive) setFetched({ shopId: sid, role: null, error: describeFirestoreError(e, '権限の確認') }); });
    return () => { alive = false; };
  }, [shop.loading, shop.shopId, shop.canManage, user.uid]);

  // 判定は純ロジックへ切り出し（src/lib/shop-role-state.ts・テストで固定）
  const { role, roleReady, roleError } = resolveShopRoleState({
    loading: shop.loading, shopId: shop.shopId, canManage: shop.canManage, fetched,
  });

  return { ...shop, role, roleReady, roleError };
}

/** 指定ロールのいずれかを持つか（オーナーは常に true・実体は shop-role-state の純関数） */
export function hasShopRole(ctx: ShopRoleCtx, roles: readonly string[]): boolean {
  return hasRole(ctx, roles);
}
