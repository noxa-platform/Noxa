/**
 * 店舗売上 → キャスト個人売上の同期トリガー
 *
 * 目的:
 *   POS/手入力で店舗側に記録した売上（shop_shops/{shopId}/sales）を、担当キャストの
 *   個人ワークスペース（personal_sales/{castUid}/items）へ「控え」として投影する。
 *   キャストが店を辞めても個人売上履歴が残る（個人 YoruLog で始めた人の体験と一致）。
 *
 * 重複しない設計:
 *   - 個人控えの doc id を店舗 saleId と同一にして set(merge) するため、同期が何度
 *     走っても上書きされるだけで複製が生まれない（冪等）。
 *   - 店舗合計は shop_shops/.../sales、個人合計は personal_sales のみを数える別軸集計
 *     なので、両方に存在しても二重計上にならない。
 *   - 取消(voided)・削除は個人控えを削除して、個人側集計から常に除外する。
 *
 * ループしない設計:
 *   本トリガーは店舗 sales のみ監視し personal_sales へ書く（逆方向は監視しない）ため、
 *   自分の書込で再発火しない。
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

const REGION = 'asia-northeast1';

/** account_users/{uid} が実在するか（= 本物のユーザーアカウントか）。
 *  端末(device)ログインの uid や operator-only の uid を個人控え対象から除外するためのガード。 */
async function isRealAccount(uid: string): Promise<boolean> {
  try {
    const snap = await db().doc(`account_users/${uid}`).get();
    return snap.exists;
  } catch {
    return false;
  }
}

const personalRef = (uid: string, saleId: string) =>
  db().doc(`personal_sales/${uid}/items/${saleId}`);

export const syncShopSaleToPersonal = onDocumentWritten(
  { document: 'shop_shops/{shopId}/sales/{saleId}', region: REGION },
  async (event) => {
    const { shopId, saleId } = event.params as { shopId: string; saleId: string };
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const prevCast = typeof before?.castUid === 'string' ? (before!.castUid as string) : null;
    const nextCast = typeof after?.castUid === 'string' ? (after!.castUid as string) : null;

    // 担当キャストが変わった/外れた場合、旧キャストの控えを削除（移し替え時の取りこぼし防止）
    if (prevCast && prevCast !== nextCast) {
      await personalRef(prevCast, saleId).delete().catch(() => undefined);
    }

    // 店舗売上が削除された → 控えも削除
    if (!after) {
      if (prevCast) await personalRef(prevCast, saleId).delete().catch(() => undefined);
      return;
    }

    // 担当不明（フリー客等）→ 投影しない
    if (!nextCast) return;

    // 取消（無効化）→ 控えを削除し個人集計から除外。un-void されれば次回 write で再生成される。
    if (after.voided === true) {
      await personalRef(nextCast, saleId).delete().catch(() => undefined);
      return;
    }

    // 端末/operator-only の uid は個人控えを作らない（本物のアカウントのみ）
    if (!(await isRealAccount(nextCast))) return;

    const ref = personalRef(nextCast, saleId);

    // createdAt は初回のみ。既存控えがあれば温存する（履歴の安定）。
    let isNew = true;
    try {
      const existing = await ref.get();
      isNew = !existing.exists;
    } catch {
      isNew = true;
    }

    const data: Record<string, unknown> = {
      shopId,
      shopSaleId: saleId,
      source: 'shop',
      entryMode: after.entryMode ?? 'amount',
      salesAmount: typeof after.amount === 'number' ? after.amount : 0,
      datetime: after.checkoutAt ?? after.createdAt ?? FieldValue.serverTimestamp(),
      customerId: after.customerId ?? null,
      customerName: after.customerName ?? null,
      castName: after.castName ?? null,
      // 内訳（注文明細）も控えへコピー＝退店後も「何を何本」が個人側で見える
      lineItems: Array.isArray(after.lineItems) ? after.lineItems : [],
      createdBy: after.operatorUid ?? nextCast,
      syncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isNew) data.createdAt = FieldValue.serverTimestamp();

    await ref.set(data, { merge: true });
  },
);
