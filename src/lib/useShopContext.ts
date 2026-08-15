'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase/config';
import { resolveStoreAccessState } from '@/lib/store-access';
import { activeMembershipIds } from '@/lib/membership';
import { describeFirestoreError } from '@/lib/firestore-error';
import { SHOP_UNRESOLVED_TEXT } from '@/lib/shop-id-state';

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
  /**
   * 判定に必要な読み取りが失敗した理由（Day109）。null なら hasShop / isOwner は確定値。
   * 値がある間、画面は「店舗が無い」前提の案内（＋店舗を登録すると解放）を出してはいけない。
   */
  error: string | null;
};

/**
 * ログインユーザーが「店舗運営モジュールを出すべきか」を判定。
 * オーナー（shop_shops.ownerUid == uid）に加え、**招待で参加したメンバー**
 * （account_users/{uid}/memberships の逆引き）も店舗ありとして扱う。
 * オーナーだけを見ると、参加直後のキャストがスマホで打刻すら開けない（store-access.ts 参照）。
 * 個人ユーザー（MyDeck のみ）は hasShop=false → 店舗 UI を出さない。
 */
const NO_SHOP: ShopContext = { loading: false, hasShop: false, isOwner: false, shops: [], error: null };
const LOADING_SHOP: ShopContext = { loading: true, hasShop: false, isOwner: false, shops: [], error: null };

export function useShopContext(uid: string | undefined): ShopContext {
  // 出所（uid）つきスナップショットから導出（useDeviceClaims と同じ理由）
  const [snap, setSnap] = useState<{ uid: string; ctx: ShopContext } | null>(null);

  useEffect(() => {
    if (!uid) return; // 未ログインは返値側で導出
    let alive = true;
    (async () => {
      // 2つの読み取りは独立させる（片方の失敗でもう片方まで消さない＝到達性の劣化を局所化）
      let failure: string | null = null;
      const owned = await getDocs(query(collection(db, 'shop_shops'), where('ownerUid', '==', uid)))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      // 所属（招待参加）の逆引き。CF が members/{uid} から同期する読み取り専用インデックス
      const ms = await getDocs(collection(db, `account_users/${uid}/memberships`))
        .catch((e) => { failure ??= describeFirestoreError(e, '店舗情報の取得'); return null; });
      if (!alive) return;
      const shops = (owned?.docs ?? []).map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id }));
      // 読み取り失敗を「店舗が無い」と同一視しない（store-access.ts の resolveStoreAccessState 参照）
      const { hasStore, isOwner, unresolved } = resolveStoreAccessState(
        owned ? shops.map((s) => s.id) : null,
        ms ? activeMembershipIds(ms.docs) : null,
      );
      setSnap({ uid, ctx: {
        loading: false, hasShop: hasStore, isOwner, shops,
        error: unresolved ? (failure ?? SHOP_UNRESOLVED_TEXT) : null,
      } });
    })();
    return () => { alive = false; };
  }, [uid]);

  if (!uid) return NO_SHOP;
  return snap?.uid === uid ? snap.ctx : LOADING_SHOP;
}
