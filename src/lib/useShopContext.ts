'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { resolveStoreAccess } from '@/lib/store-access';

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
const NO_DEVICE: DeviceClaims = { loading: false, isDevice: false, allow: [], label: '', shopId: '' };
const LOADING_DEVICE: DeviceClaims = { loading: true, isDevice: false, allow: [], label: '', shopId: '' };

export function useDeviceClaims(user: User | undefined): DeviceClaims {
  // 出所（uid）つきスナップショットから導出。uid 不一致＝別ユーザーの結果は返さない
  // （ログアウト→別ユーザー再ログイン時に前ユーザーの claims が解決まで漏れるのを防ぐ）
  const [snap, setSnap] = useState<{ uid: string; claims: DeviceClaims } | null>(null);
  useEffect(() => {
    if (!user) return; // 未ログインは返値側で導出（effect 内の同期 setState はカスケード再レンダー）
    const uid = user.uid;
    let alive = true;
    user.getIdTokenResult().then((r) => {
      if (!alive) return;
      const isDevice = r.claims.device === true;
      setSnap({ uid, claims: {
        loading: false,
        isDevice,
        allow: Array.isArray(r.claims.allow) ? (r.claims.allow as string[]) : [],
        label: typeof r.claims.label === 'string' ? r.claims.label : '',
        shopId: typeof r.claims.shopId === 'string' ? r.claims.shopId : '',
      } });
    }).catch(() => { if (alive) setSnap({ uid, claims: NO_DEVICE }); });
    return () => { alive = false; };
  }, [user]);
  if (!user) return NO_DEVICE;
  return snap?.uid === user.uid ? snap.claims : LOADING_DEVICE;
}

export type ShopContext = {
  loading: boolean;
  /** 店舗（オーナー or 招待で参加したメンバー）に到達できるか＝店舗運営モジュールを出すか */
  hasShop: boolean;
  /** 自分がオーナーの店舗を持つか（店舗登録 CTA の要否判定用。所属メンバーは false） */
  isOwner: boolean;
  /** 自分がオーナーの店舗一覧（従来どおりオーナー分のみ） */
  shops: { id: string; name: string }[];
};

/**
 * ログインユーザーが「店舗運営モジュールを出すべきか」を判定。
 * オーナー（shop_shops.ownerUid == uid）に加え、**招待で参加したメンバー**
 * （account_users/{uid}/memberships の逆引き）も店舗ありとして扱う。
 * オーナーだけを見ると、参加直後のキャストがスマホで打刻すら開けない（store-access.ts 参照）。
 * 個人ユーザー（MyDeck のみ）は hasShop=false → 店舗 UI を出さない。
 */
const NO_SHOP: ShopContext = { loading: false, hasShop: false, isOwner: false, shops: [] };
const LOADING_SHOP: ShopContext = { loading: true, hasShop: false, isOwner: false, shops: [] };

export function useShopContext(uid: string | undefined): ShopContext {
  // 出所（uid）つきスナップショットから導出（useDeviceClaims と同じ理由）
  const [snap, setSnap] = useState<{ uid: string; ctx: ShopContext } | null>(null);

  useEffect(() => {
    if (!uid) return; // 未ログインは返値側で導出
    let alive = true;
    (async () => {
      try {
        const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)));
        // 所属（招待参加）の逆引き。CF が members/{uid} から同期する読み取り専用インデックス
        const ms = await getDocs(collection(db, `account_users/${uid}/memberships`));
        if (!alive) return;
        const shops = owned.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
        const { hasStore, isOwner } = resolveStoreAccess(shops.map((s) => s.id), ms.docs.map((d) => d.id));
        setSnap({ uid, ctx: { loading: false, hasShop: hasStore, isOwner, shops } });
      } catch {
        if (alive) setSnap({ uid, ctx: NO_SHOP });
      }
    })();
    return () => { alive = false; };
  }, [uid]);

  if (!uid) return NO_SHOP;
  return snap?.uid === uid ? snap.ctx : LOADING_SHOP;
}
