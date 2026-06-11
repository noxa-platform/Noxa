'use client';

/**
 * 業種テーマの適用。全UIは var(--noxa-*) 参照のため <html data-theme> を切り替えるだけで反映。
 * 優先: ユーザーの手動上書き(localStorage) → 店舗の業態(storeTypeName) → 既定(ダーク)。
 */
import { useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { getActiveShop, pickShopId } from '@/lib/workspace';

export const THEME_KEY = 'noxa_theme'; // '' | 'auto' | 'noxa' | 'concafe'

export function industryToTheme(storeTypeName?: string): string {
  if (storeTypeName === 'コンカフェ') return 'concafe';
  return '';
}

export function applyTheme(theme: string): void {
  if (typeof document === 'undefined') return;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function useTheme(user: User | undefined): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const override = localStorage.getItem(THEME_KEY) || 'auto';
    if (override === 'noxa') { applyTheme(''); return; }
    if (override === 'concafe') { applyTheme('concafe'); return; }
    // auto: 店舗の業態から解決
    if (!user) { applyTheme(''); return; }
    let alive = true;
    (async () => {
      try {
        let storeTypeName: string | undefined;
        const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
        const ownedById = new Map(owned.docs.map((d) => [d.id, d]));
        const { shopId } = pickShopId(owned.docs.map((d) => d.id), ms.docs.map((d) => d.id), getActiveShop());
        if (shopId) {
          const docData = ownedById.get(shopId)?.data() ?? (await getDoc(doc(db, `shop_shops/${shopId}`))).data();
          storeTypeName = (docData as { storeTypeName?: string } | undefined)?.storeTypeName;
        }
        if (alive) applyTheme(industryToTheme(storeTypeName));
      } catch { applyTheme(''); }
    })();
    return () => { alive = false; };
  }, [user?.uid]);
}
