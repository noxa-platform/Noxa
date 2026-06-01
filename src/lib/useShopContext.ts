'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

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
