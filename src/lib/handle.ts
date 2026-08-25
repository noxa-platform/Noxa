'use client';

/**
 * ハンドル（公開ID）管理。
 * - 個人/店舗の作成時に必須付与。`profile_pages/{handle}` をトランザクションで claim（ユニーク性担保）。
 * - 公開プロフィール（リンク集）の URL キー: /u/<handle>（個人）, /s/<handle>（店舗）。
 */
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { VISIBILITY, type Visibility, resolveVisibility } from '@/lib/visibility';

export { VISIBILITY, resolveVisibility };
export type { Visibility };

// 純ルール（検証・候補生成）は firebase 非依存の handle-rules に分離（テスト対象・Day25）
export { HANDLE_RE, validateHandle, suggestHandle } from '@/lib/handle-rules';
import { validateHandle, planHandleChange } from '@/lib/handle-rules';
import { stampIrVersion } from '@/lib/ir-version';

export type ProfileType = 'user' | 'shop';

export async function isHandleAvailable(handle: string): Promise<boolean> {
  const h = validateHandle(handle);
  if (!h) return false;
  const snap = await getDoc(doc(db, `profile_pages/${h}`));
  return !snap.exists();
}

export type ClaimInput = {
  type: ProfileType;
  ownerUid: string;          // 所有者 uid（個人=本人, 店舗=オーナー）
  refId: string;             // 個人=uid, 店舗=shopId
  displayName?: string;
  avatar?: string;
};

/**
 * ハンドルを claim して profile_pages/{handle} を作成（published=false）。
 * 併せて呼び出し側コレクション（account_users / shop_shops）の handle フィールドも更新する。
 * 既に取得済みなら HANDLE_TAKEN を投げる。
 */
export async function claimHandle(handleRaw: string, input: ClaimInput): Promise<string> {
  const h = validateHandle(handleRaw);
  if (!h) throw new Error('INVALID_HANDLE');

  const pageRef = doc(db, `profile_pages/${h}`);
  const ownerRef = input.type === 'user'
    ? doc(db, `account_users/${input.refId}`)
    : doc(db, `shop_shops/${input.refId}`);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(pageRef);
    if (existing.exists()) throw new Error('HANDLE_TAKEN');
    tx.set(pageRef, stampIrVersion({
      handle: h,
      type: input.type,
      ownerUid: input.ownerUid,
      refId: input.refId,
      displayName: input.displayName ?? '',
      avatar: input.avatar ?? '',
      bio: '',
      sns: [],
      published: false,
      visibility: 'private',   // 新規は非公開で作成（published:false と整合）
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    tx.set(ownerRef, { handle: h, updatedAt: serverTimestamp() }, { merge: true });
  });
  return h;
}

export type SnsLink = { platform: string; url: string };
export type ProfilePage = {
  handle: string;
  type: ProfileType;
  ownerUid: string;
  refId: string;
  displayName: string;
  avatar: string;
  bio: string;               // 旧フィールド（blocks 移行後は表示に使わない・fallback 用）
  sns: SnsLink[];            // 旧フィールド（同上）
  published: boolean;        // 後方互換のため残す（visibility が正本）
  visibility?: Visibility;   // 正本（未設定の既存docは published から導出）
  blocks?: unknown[];        // NOXAページのブロック（正本。normalizeBlocks で安全に読む）
  shopHandle?: string;
};

/** profile_pages/{handle} の内容を更新（本人のみ・ルールで担保） */
export async function updateProfilePage(handle: string, patch: Partial<Omit<ProfilePage, 'handle' | 'type' | 'ownerUid' | 'refId'>>): Promise<void> {
  const clean = JSON.parse(JSON.stringify(patch)); // undefined 除去
  await runTransaction(db, async (tx) => {
    const ref = doc(db, `profile_pages/${handle}`);
    const cur = await tx.get(ref);
    if (!cur.exists()) throw new Error('NOT_FOUND');
    tx.set(ref, { ...clean, updatedAt: serverTimestamp() }, { merge: true });
  });
}

/**
 * 個人ハンドルを変更（旧 profile_pages の内容を新 handle へ移し、account_users.handle を更新）。
 * 旧 /u/<oldHandle> は404になる点に注意（呼び出し側で警告）。
 */
export async function changeUserHandle(uid: string, oldHandle: string, newHandleRaw: string): Promise<string> {
  // old も正規化して比較・参照する（doc パスは case-sensitive のため未正規化 old は
  // 誤 doc を指しデータ損失＝孤児プロフィールになる。planHandleChange で一元化・Day57）
  const plan = planHandleChange(oldHandle, newHandleRaw);
  if (!plan) throw new Error('INVALID_HANDLE');
  if (plan.noop) return plan.newH;
  const { oldH, newH } = plan;
  const oldRef = doc(db, `profile_pages/${oldH}`);
  const newRef = doc(db, `profile_pages/${newH}`);
  const userRef = doc(db, `account_users/${uid}`);
  await runTransaction(db, async (tx) => {
    const newExisting = await tx.get(newRef);
    if (newExisting.exists()) throw new Error('HANDLE_TAKEN');
    const old = await tx.get(oldRef);
    const data = old.exists() ? old.data() : {};
    tx.set(newRef, { ...data, handle: newH, ownerUid: uid, type: 'user', refId: uid, updatedAt: serverTimestamp() });
    tx.set(userRef, { handle: newH, updatedAt: serverTimestamp() }, { merge: true });
    if (old.exists()) tx.delete(oldRef);
  });
  return newH;
}

export async function getProfilePage(handle: string): Promise<ProfilePage | null> {
  const h = (handle ?? '').toLowerCase();
  const snap = await getDoc(doc(db, `profile_pages/${h}`));
  if (!snap.exists()) return null;
  return snap.data() as ProfilePage;
}
