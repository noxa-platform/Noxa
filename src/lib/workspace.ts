'use client';

/**
 * ワークスペース（操作対象）の選択。
 * 1ユーザーが複数店舗のオーナー/スタッフになれ、かつ個人ワークスペースも持つため、
 * 「今どの店舗（or 個人）を操作しているか」を1か所で持ち、全リゾルバが従う。
 * 保存: localStorage 'noxa_active_shop' = 'personal' | <shopId> | (未設定＝自動で先頭店舗)
 */
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';

export const ACTIVE_SHOP_KEY = 'noxa_active_shop';

export function getActiveShop(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_SHOP_KEY);
}
export function setActiveShop(v: string | null) {
  if (typeof window === 'undefined') return;
  if (v === null) localStorage.removeItem(ACTIVE_SHOP_KEY);
  else localStorage.setItem(ACTIVE_SHOP_KEY, v);
}

/** owned/member の店舗ID群 ＋ アクティブ選択 → 操作対象 shopId を決定 */
export function pickShopId(ownedIds: string[], memberIds: string[], active: string | null): { shopId: string | null; isOwner: boolean } {
  if (active === 'personal') return { shopId: null, isOwner: false };
  const all = [...ownedIds, ...memberIds];
  const chosen = (active && all.includes(active)) ? active : (ownedIds[0] ?? memberIds[0] ?? null);
  return { shopId: chosen, isOwner: !!chosen && ownedIds.includes(chosen) };
}

export type Workspace = { id: string; name: string; role: 'owner' | 'member' };
export type UseWorkspaces = { loading: boolean; items: Workspace[]; activeId: string | 'personal' };

/** 切替UI用: 所有/所属する店舗一覧＋現在のアクティブを返す */
export function useWorkspaces(user: User): UseWorkspaces {
  const [state, setState] = useState<UseWorkspaces>({ loading: true, items: [], activeId: 'personal' });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid)));
        const items: Workspace[] = owned.docs.map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name ?? d.id, role: 'owner' }));
        const ms = await getDocs(collection(db, `account_users/${user.uid}/memberships`));
        for (const m of ms.docs) {
          if (items.some((x) => x.id === m.id)) continue;
          const s = await getDoc(doc(db, `shop_shops/${m.id}`));
          items.push({ id: m.id, name: (s.data() as { name?: string } | undefined)?.name ?? m.id, role: 'member' });
        }
        if (!alive) return;
        const ids = items.map((i) => i.id);
        const active = getActiveShop();
        const activeId: string | 'personal' = active === 'personal' ? 'personal'
          : (active && ids.includes(active)) ? active
          : (items[0]?.id ?? 'personal');
        setState({ loading: false, items, activeId });
      } catch {
        if (alive) setState({ loading: false, items: [], activeId: 'personal' });
      }
    })();
    return () => { alive = false; };
  }, [user.uid]);
  return state;
}
