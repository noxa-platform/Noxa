'use client';

/**
 * 業種テーマの適用。全UIは var(--noxa-*) 参照のため <html data-theme> を切り替えるだけで反映。
 * 優先: ユーザーの手動上書き(localStorage) → 店舗の業態(storeTypeName) → 既定(ダーク)。
 */
import { useEffect } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';

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
        if (!owned.empty) storeTypeName = (owned.docs[0].data() as { storeTypeName?: string }).storeTypeName;
        else {
          const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
          if (!ms.empty) { const s = await getDoc(doc(db, `shop_shops/${ms.docs[0].id}`)); storeTypeName = (s.data() as { storeTypeName?: string } | undefined)?.storeTypeName; }
        }
        if (alive) applyTheme(industryToTheme(storeTypeName));
      } catch { applyTheme(''); }
    })();
    return () => { alive = false; };
  }, [user?.uid]);
}
