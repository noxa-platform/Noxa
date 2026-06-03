'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { useDeviceClaims } from '@/lib/useShopContext';

/**
 * 操作対象 shopId を解決する共通フック。
 * 優先: 店舗デバイスログイン(claims.shopId) → オーナー shop → 所属 shop(memberships)。
 * canManage = オーナー（owner/manager 相当の書込が必要な機微モジュール用）。
 */
export type ShopId = { loading: boolean; shopId: string | null; canManage: boolean; isDevice: boolean };

export function useShopId(user: User): ShopId {
  const device = useDeviceClaims(user);
  const [s, setS] = useState<ShopId>({ loading: true, shopId: null, canManage: false, isDevice: false });
  useEffect(() => {
    if (device.loading) return;
    let alive = true;
    (async () => {
      if (device.isDevice && device.shopId) {
        if (alive) setS({ loading: false, shopId: device.shopId, canManage: false, isDevice: true });
        return;
      }
      try {
        const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        if (!alive) return;
        if (!owned.empty) { setS({ loading: false, shopId: owned.docs[0].id, canManage: true, isDevice: false }); return; }
        const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
        if (!alive) return;
        setS({ loading: false, shopId: ms.empty ? null : ms.docs[0].id, canManage: false, isDevice: false });
      } catch {
        if (alive) setS({ loading: false, shopId: null, canManage: false, isDevice: false });
      }
    })();
    return () => { alive = false; };
  }, [user.uid, device.loading, device.isDevice, device.shopId]);
  return s;
}
