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
import { activeMemberships, keepMembershipWorkspace } from '@/lib/membership';

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

/** 所有店舗＋所属インデックスを切替リストに畳む（純関数）。所有が先・重複は所有を優先。 */
export function mergeWorkspaces(
  owned: readonly { id: string; name?: string | null }[],
  memberships: readonly { id: string; name?: string | null }[],
): Workspace[] {
  const items: Workspace[] = owned.map((o) => ({ id: o.id, name: o.name || o.id, role: 'owner' }));
  for (const m of memberships) {
    if (items.some((x) => x.id === m.id)) continue;
    items.push({ id: m.id, name: m.name || m.id, role: 'member' });
  }
  return items;
}

/** localStorage の選択値と実在する一覧から、現在のアクティブを決める（純関数）。 */
export function pickActiveId(ids: readonly string[], stored: string | null): string | 'personal' {
  if (stored === 'personal') return 'personal';
  if (stored && ids.includes(stored)) return stored;
  return ids[0] ?? 'personal';
}

/**
 * 切替UI用: 所有/所属する店舗一覧＋現在のアクティブを返す。
 *
 * 読み取りは**1件でも失敗したら全部消える**構造にしないこと。旧実装は所有クエリ・
 * 所属クエリ・所属ごとの店舗 doc 取得を1つの try で束ねていたため、たとえば
 * 「退店したのに memberships インデックスが残っている」1件（CF の削除同期は
 * `.catch(() => undefined)` で握り潰されるので実際に起こり得る）で
 * `shop_shops/{id}` が permission-denied になると **items が丸ごと空**になった。
 * items が空だと WorkspaceSwitcher 自体が消えるので、個人ワークスペースを選択中の
 * ユーザーは自分の店に戻る手段を失う（サイドバーの店舗ナビは shopId 未選択で出ない）＝行き止まり。
 * そこで所有・所属・各店舗名の取得をそれぞれ独立させ、失敗はその要素だけを劣化させる。
 */
export function useWorkspaces(user: User): UseWorkspaces {
  const [state, setState] = useState<UseWorkspaces>({ loading: true, items: [], activeId: 'personal' });
  useEffect(() => {
    let alive = true;
    (async () => {
      const ownedSnap = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', user.uid))).catch(() => null);
      const msSnap = await getDocs(collection(db, `account_users/${user.uid}/memberships`)).catch(() => null);
      const owned = (ownedSnap?.docs ?? []).map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name }));
      // 在籍中の所属だけを候補にする（判定は membership.ts に 1 本化・Day122）。
      // 店舗名は CF が denormalize 済み（shopName）だが、**店舗そのものが消えていても
      // index には残る**（掃除トリガーは今後の削除にしか効かない・Day121）。消えた店を
      // 切替リストに並べると、選んだ瞬間に何も開けない行き止まりになるので実在を確認する。
      // 取得できなかった場合は**消さずに残す**（読み取り失敗を「店が無い」に倒さない・Day109）。
      const memberships = (await Promise.all(activeMemberships(msSnap?.docs ?? []).map(async (m) => {
        const shop = await getDoc(doc(db, `shop_shops/${m.id}`)).catch(() => null);
        // 削除済みと**確認できた**ものだけ落とす（確認できなかった null は残す）
        if (!keepMembershipWorkspace(shop ? shop.exists() : null)) return null;
        return { id: m.id, name: m.name ?? (shop?.data() as { name?: string } | undefined)?.name };
      }))).filter((m): m is { id: string; name: string | undefined } => m !== null);
      if (!alive) return;
      const items = mergeWorkspaces(owned, memberships);
      setState({ loading: false, items, activeId: pickActiveId(items.map((i) => i.id), getActiveShop()) });
    })();
    return () => { alive = false; };
  }, [user.uid]);
  return state;
}
