'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';

export type DeviceClaims = {
  loading: boolean;
  isDevice: boolean;
  allow: string[];   // 許可モジュール key（pos, seating, ...）
  label: string;     // 端末プロファイル名
  shopId: string;
};

/**
 * 店舗デバイスログイン（Custom Token + claims）かどうかを判定。
 * device=true なら個人機能を隠し、allow のモジュールだけ表示する。
 */
export function useDeviceClaims(user: User | undefined): DeviceClaims {
  const [c, setC] = useState<DeviceClaims>({ loading: true, isDevice: false, allow: [], label: '', shopId: '' });
  useEffect(() => {
    if (!user) { setC({ loading: false, isDevice: false, allow: [], label: '', shopId: '' }); return; }
    let alive = true;
    user.getIdTokenResult().then((r) => {
      if (!alive) return;
      const isDevice = r.claims.device === true;
      setC({
        loading: false,
        isDevice,
        allow: Array.isArray(r.claims.allow) ? (r.claims.allow as string[]) : [],
        label: typeof r.claims.label === 'string' ? r.claims.label : '',
        shopId: typeof r.claims.shopId === 'string' ? r.claims.shopId : '',
      });
    }).catch(() => { if (alive) setC({ loading: false, isDevice: false, allow: [], label: '', shopId: '' }); });
    return () => { alive = false; };
  }, [user]);
  return c;
}

export type ShopContext = {
  loading: boolean;
  hasShop: boolean;
  shops: { id: string; name: string }[];
};

/**
 * ログインユーザーが店舗オーナーか（= 店舗運営モジュールを出すべきか）を判定。
 * shop_shops で ownerUid == uid のドキュメントを引く。
 * 個人ユーザー（MyDeck のみ）は hasShop=false → 店舗 UI を出さない。
 */
export function useShopContext(uid: string | undefined): ShopContext {
  const [state, setState] = useState<ShopContext>({ loading: true, hasShop: false, shops: [] });

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, hasShop: false, shops: [] });
      return;
    }
    let alive = true;
    getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)))
      .then((snap) => {
        if (!alive) return;
        const shops = snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
        setState({ loading: false, hasShop: shops.length > 0, shops });
      })
      .catch(() => {
        if (alive) setState({ loading: false, hasShop: false, shops: [] });
      });
    return () => { alive = false; };
  }, [uid]);

  return state;
}
