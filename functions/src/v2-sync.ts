/**
 * v2 schema 同期トリガー
 *
 * 1. shop_shops → shop_public_profiles 同期
 *    内部運営 doc から公開フィールドだけを抽出して別 collection へコピー。
 *    Rules で「shop_shops = members only / shop_public_profiles = public」を実現。
 *
 * 2. shop_shops/{shopId}/members/{uid} ↔ account_users/{uid}/memberships/{shopId} 逆引き同期
 *    「自分が所属する全 shop」を 1 クエリで引けるようにする非正規化。
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

setGlobalOptions({ region: 'asia-northeast1' });

const PUBLIC_FIELDS = [
  'name', 'handle', 'area', 'description', 'hours',
  'phone', 'email', 'address', 'seatCount', 'gallery',
  'tags', 'links', 'businessType', 'is_published', 'status',
] as const;

/**
 * shop_shops/{shopId} 書込時に shop_public_profiles/{shopId} を同期。
 * - create: 公開フィールドだけコピーした doc を作る
 * - update: 公開フィールドの変更分だけ反映
 * - delete: shop_public_profiles/{shopId} も削除
 */
export const syncShopPublicProfile = onDocumentWritten(
  'shop_shops/{shopId}',
  async (event) => {
    const shopId = event.params.shopId;
    const after = event.data?.after.data();
    const before = event.data?.before.data();
    const publicRef = db().doc(`shop_public_profiles/${shopId}`);

    if (!after) {
      // 削除
      await publicRef.delete().catch(() => undefined);
      return;
    }

    const publicData: Record<string, unknown> = {
      id: shopId,
      ownerUid: after.ownerUid ?? null,
      source: after.source ?? 'owner_registered',
      updatedAt: FieldValue.serverTimestamp(),
    };

    for (const key of PUBLIC_FIELDS) {
      if (after[key] !== undefined) publicData[key] = after[key];
    }

    if (!before) {
      // 新規
      publicData.createdAt = FieldValue.serverTimestamp();
    }

    await publicRef.set(publicData, { merge: true });
  },
);

/**
 * shop_shops/{shopId}/members/{uid} 書込時に
 * account_users/{uid}/memberships/{shopId} を同期。
 * 逆引きインデックスとして「自分が所属する全 shop」を 1 クエリで引ける。
 */
export const syncMembershipIndex = onDocumentWritten(
  'shop_shops/{shopId}/members/{uid}',
  async (event) => {
    const { shopId, uid } = event.params;
    const after = event.data?.after.data();
    const indexRef = db().doc(`account_users/${uid}/memberships/${shopId}`);

    if (!after) {
      await indexRef.delete().catch(() => undefined);
      return;
    }

    // shop の名前を取得して denormalize (ホーム画面で名前表示用)
    let shopName: string | null = null;
    try {
      const shopSnap = await db().doc(`shop_shops/${shopId}`).get();
      shopName = (shopSnap.data()?.name as string | undefined) ?? null;
    } catch { /* ignore */ }

    await indexRef.set({
      shopId,
      uid,
      role: after.role ?? 'cast',
      status: after.status ?? 'active',
      castDisplayName: after.castDisplayName ?? null,
      shopName,
      joinedAt: after.joinedAt ?? FieldValue.serverTimestamp(),
      leftAt: after.leftAt ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  },
);

/**
 * shop_shops/{shopId} の name 変更時、関連 memberships の shopName denormalize を更新。
 */
export const syncShopNameToMemberships = onDocumentWritten(
  'shop_shops/{shopId}',
  async (event) => {
    const shopId = event.params.shopId;
    const after = event.data?.after.data();
    const before = event.data?.before.data();

    if (!after || (before?.name === after.name)) return;

    const membersSnap = await db().collection(`shop_shops/${shopId}/members`).get();
    const batch = db().batch();
    for (const m of membersSnap.docs) {
      const uid = m.id;
      batch.set(
        db().doc(`account_users/${uid}/memberships/${shopId}`),
        { shopName: after.name ?? null, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    await batch.commit();
  },
);
