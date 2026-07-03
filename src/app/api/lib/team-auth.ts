// 店舗ロール認可の共通ヘルパー（API Route / Admin SDK 用）。
// Admin SDK は rules をバイパスするため、shopId を受け取る API は必ずここで権限確認する。
import type { Firestore } from 'firebase-admin/firestore';

export type ShopRole = 'owner' | 'manager' | 'cast' | 'accounting' | string;

/**
 * uid が shopId に対して指定ロールのいずれかを持つか検証する。
 * ownerUid 一致は常に 'owner' 扱い（members doc が無い初期店舗でも許可）。
 */
export async function getShopRole(db: Firestore, shopId: string, uid: string): Promise<ShopRole | null> {
  const shopSnap = await db.doc(`shop_shops/${shopId}`).get();
  if (!shopSnap.exists) return null;
  if ((shopSnap.data() as { ownerUid?: string } | undefined)?.ownerUid === uid) return 'owner';
  const me = await db.doc(`shop_shops/${shopId}/members/${uid}`).get();
  return me.exists ? ((me.data() as { role?: string }).role ?? null) : null;
}

export async function requireShopRole(
  db: Firestore,
  shopId: string,
  uid: string,
  roles: ShopRole[],
): Promise<{ ok: true; role: ShopRole } | { ok: false; status: number; error: string }> {
  const role = await getShopRole(db, shopId, uid);
  if (role === null) return { ok: false, status: 404, error: 'お店が見つからないか、メンバーではありません' };
  if (!roles.includes(role)) return { ok: false, status: 403, error: `権限がありません（${roles.join('/')} のみ）` };
  return { ok: true, role };
}
