'use client';

/**
 * 会計（sales）の取消・修正。決済は持たない（現金/掛け/カードは店舗運用）。
 * 取消は削除でなく無効化（voided）＋理由・操作者を記録し、集計から除外する。
 * 修正は金額/客名/担当などを更新し、訂正者・訂正時刻を残す（監査）。
 * 権限は firestore.rules（sales: 売上編集権限 or 本人 castUid）で担保。
 */
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

export async function voidSale(shopId: string, saleId: string, reason: string, uid: string): Promise<void> {
  await updateDoc(doc(db, `shop_shops/${shopId}/sales/${saleId}`), {
    voided: true, voidedAt: serverTimestamp(), voidedBy: uid, voidReason: reason ?? '',
  });
}

export async function unvoidSale(shopId: string, saleId: string): Promise<void> {
  await updateDoc(doc(db, `shop_shops/${shopId}/sales/${saleId}`), { voided: false });
}

export type SaleEdit = { amount?: number; customerName?: string; castName?: string; guests?: number; memo?: string };

export async function editSale(shopId: string, saleId: string, patch: SaleEdit, uid: string): Promise<void> {
  const clean: Record<string, unknown> = { correctedAt: serverTimestamp(), correctedBy: uid };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== '') clean[k] = v;
  await updateDoc(doc(db, `shop_shops/${shopId}/sales/${saleId}`), clean);
}
