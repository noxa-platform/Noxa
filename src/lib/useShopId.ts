'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';
import { getActiveShop } from '@/lib/workspace';
import { describeFirestoreError } from '@/lib/firestore-error';
import { resolveShopIdState, SHOP_UNRESOLVED_TEXT } from '@/lib/shop-id-state';

/**
 * 操作対象 shopId を解決する共通フック。
 * 優先: 店舗デバイスログイン(claims.shopId) → アクティブ選択(複数店舗対応) → 先頭店舗。
 * canManage = オーナー（owner/manager 相当の書込が必要な機微モジュール用）。
 */
export type ShopId = {
  loading: boolean;
  shopId: string | null;
  canManage: boolean;
  isDevice: boolean;
  /**
   * 店舗の**確認に失敗**した理由（Day109）。「所属していない」（shopId=null かつ shopError=null）とは意味が違う。
   * 混ぜると通信断で「所属店舗が見つかりません」と言い切り、在籍中のスタッフが未所属に見える。
   * 画面側は describeMissingShop() 経由で文言を出す（shop-id-state.ts）。
   */
  shopError: string | null;
};

export function useShopId(user: User): ShopId {
  const device = useDeviceClaims(user);
  const [s, setS] = useState<ShopId>({ loading: true, shopId: null, canManage: false, isDevice: false, shopError: null });
  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      if (device.isDevice && device.shopId) {
        if (alive) setS({ loading: false, shopId: device.shopId, canManage: false, isDevice: true, shopError: null });
        return;
      }
      // 2つの読み取りは独立させる（片方の失敗で結論を黙って変えない＝ shop-id-state.ts 参照）
      let failure: string | null = null;
      const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)))
        .then((snap) => snap.docs.map((d) => d.id))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`))
        .then((snap) => snap.docs.map((d) => d.id))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      if (!alive) return;
      const st = resolveShopIdState({ owned, memberships: ms, active: getActiveShop() });
      setS({
        loading: false,
        shopId: st.shopId,
        canManage: st.isOwner,
        isDevice: false,
        shopError: st.unresolved ? (failure ?? SHOP_UNRESOLVED_TEXT) : null,
      });
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);
  return s;
}
