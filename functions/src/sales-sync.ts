/**
 * 店舗売上 → キャスト個人データの同期トリガー（会計→担当台帳/個人売上を1本に繋ぐ）
 *
 * 目的:
 *   POS/手入力で店舗側に記録した売上（shop_shops/{shopId}/sales）を、担当キャストの
 *   個人データへ投影する。キャストが店を辞めても個人履歴が残る。
 *
 * 投影先は「顧客が紐付いているか」で排他に振り分ける（member-stats の二重計上を防ぐ）:
 *   - 顧客あり（customerId あり）= Phase2「会計時に自動移動」
 *       personal_customers/{castUid}/items/{customerId} に顧客 doc を upsert（無ければ
 *       shop customers からプロフィールをコピー、docID 保持）＋
 *       /logs/{saleId} に ContactLog(type='visit') を転記。
 *       → member-stats は personal_customers/logs を集計するので担当成績に乗る。
 *       shop customers 側は POS の顧客マスタとして残す（物理削除しない＝再来店も選べる）。
 *   - 顧客なし（フリー客）= 従来の「顧客なし日売」
 *       personal_sales/{castUid}/items/{saleId} に控えを set(merge)。
 *
 * 重複しない/壊れない設計:
 *   - 投影 doc id を店舗 saleId と同一にして set(merge)＝何度発火しても上書きで冪等。
 *   - 顧客台帳の totalSales/visitCount は「ログの差額」で増減（再発火・金額修正でも
 *     ズレない）。ログ削除時は同額を減算。
 *   - 顧客あり/なしを排他にし、member-stats（logs と personal_sales の両方を集計）の
 *     二重計上を防ぐ。担当変更/顧客変更/取消(voided)/削除に追従して旧投影を除去。
 *   - 端末(device)/operator-only の uid（account_users 不在）は投影しない。
 *
 * ループしない設計:
 *   本トリガーは店舗 sales のみ監視し personal_* へ書く（逆方向は監視しない）ため再発火しない。
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

const REGION = 'asia-northeast1';

/** account_users/{uid} が実在するか（端末/operator-only uid を投影対象から除外）。 */
async function isRealAccount(uid: string): Promise<boolean> {
  try {
    return (await db().doc(`account_users/${uid}`).get()).exists;
  } catch {
    return false;
  }
}

const personalSaleRef = (uid: string, saleId: string) =>
  db().doc(`personal_sales/${uid}/items/${saleId}`);
const personalCustomerRef = (uid: string, customerId: string) =>
  db().doc(`personal_customers/${uid}/items/${customerId}`);
const customerLogRef = (uid: string, customerId: string, saleId: string) =>
  db().doc(`personal_customers/${uid}/items/${customerId}/logs/${saleId}`);
const shopCustomerRef = (shopId: string, customerId: string) =>
  db().doc(`shop_shops/${shopId}/customers/${customerId}`);

type SaleData = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// ── 顧客あり: 担当台帳へ ContactLog 転記（顧客 doc upsert＋差額 increment・冪等） ──
async function writeCustomerLog(shopId: string, cast: string, customerId: string, saleId: string, after: SaleData) {
  const logRef = customerLogRef(cast, customerId, saleId);
  const custRef = personalCustomerRef(cast, customerId);
  const shopCustRef = shopCustomerRef(shopId, customerId);
  const amount = num(after.amount);
  const datetime = after.checkoutAt ?? after.createdAt ?? FieldValue.serverTimestamp();

  await db().runTransaction(async (tx) => {
    const [logSnap, custSnap, shopCustSnap] = await Promise.all([
      tx.get(logRef), tx.get(custRef), tx.get(shopCustRef),
    ]);
    const prevLogged = logSnap.exists;
    const prevAmount = prevLogged ? num(logSnap.data()?.salesAmount) : 0;

    if (!custSnap.exists) {
      // 初回はプロフィールをコピーして担当台帳を新設（集計値はログ起点でリセット）
      const base = (shopCustSnap.exists ? shopCustSnap.data() : {}) as Record<string, unknown>;
      tx.set(custRef, {
        ...base,
        name: str(base.name) ?? str(after.customerName) ?? '—',
        mainCastUid: cast,
        totalSales: amount,
        visitCount: 1,
        lastContactAt: datetime,
        assignedFromShopId: shopId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      // 既存台帳は差額のみ反映（再発火=0、金額修正=差額、初ログ=満額＋来店+1）
      tx.set(custRef, {
        totalSales: FieldValue.increment(amount - prevAmount),
        visitCount: FieldValue.increment(prevLogged ? 0 : 1),
        lastContactAt: datetime,
        mainCastUid: cast,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.set(logRef, {
      type: 'visit',
      salesAmount: amount,
      countAsGroup: true,
      datetime,
      source: str(after.source) ?? 'pos',
      posSaleRef: `shop_shops/${shopId}/sales/${saleId}`,
      shopId,
      customerName: str(after.customerName),
      ...(prevLogged ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // 移行クリーンアップ: 同 saleId の personal_sales 控えが残っていれば除去（顧客あり↔なし切替/旧仕様分）
  await personalSaleRef(cast, saleId).delete().catch(() => undefined);
}

// ── 顧客あり: 担当台帳のログを除去（差額減算・冪等） ──
async function removeCustomerLog(cast: string, customerId: string, saleId: string) {
  const logRef = customerLogRef(cast, customerId, saleId);
  const custRef = personalCustomerRef(cast, customerId);
  await db().runTransaction(async (tx) => {
    const logSnap = await tx.get(logRef);
    if (!logSnap.exists) return;
    const amt = num(logSnap.data()?.salesAmount);
    tx.set(custRef, {
      totalSales: FieldValue.increment(-amt),
      visitCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.delete(logRef);
  });
}

// ── 顧客なし: personal_sales へ控えを upsert ──
async function writePersonalSale(shopId: string, cast: string, saleId: string, after: SaleData) {
  const ref = personalSaleRef(cast, saleId);
  let isNew = true;
  try { isNew = !(await ref.get()).exists; } catch { isNew = true; }
  const data: Record<string, unknown> = {
    shopId,
    shopSaleId: saleId,
    source: 'shop',
    entryMode: str(after.entryMode) ?? 'amount',
    salesAmount: num(after.amount),
    datetime: after.checkoutAt ?? after.createdAt ?? FieldValue.serverTimestamp(),
    customerId: null,
    customerName: str(after.customerName),
    castName: str(after.castName),
    lineItems: Array.isArray(after.lineItems) ? after.lineItems : [],
    createdBy: str(after.operatorUid) ?? cast,
    syncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (isNew) data.createdAt = FieldValue.serverTimestamp();
  await ref.set(data, { merge: true });
}

// ── 投影の振り分け（顧客あり=台帳ログ / 顧客なし=personal_sales） ──
async function removeProjection(cast: string, customerId: string | null, saleId: string) {
  if (customerId) {
    await removeCustomerLog(cast, customerId, saleId);
    await personalSaleRef(cast, saleId).delete().catch(() => undefined); // 念のため
  } else {
    await personalSaleRef(cast, saleId).delete().catch(() => undefined);
  }
}

async function writeProjection(shopId: string, cast: string, customerId: string | null, saleId: string, after: SaleData) {
  if (customerId) await writeCustomerLog(shopId, cast, customerId, saleId, after);
  else await writePersonalSale(shopId, cast, saleId, after);
}

export const syncShopSaleToPersonal = onDocumentWritten(
  { document: 'shop_shops/{shopId}/sales/{saleId}', region: REGION },
  async (event) => {
    const { shopId, saleId } = event.params as { shopId: string; saleId: string };
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const prevCast = str(before?.castUid);
    const nextCast = str(after?.castUid);
    const prevCustomerId = str(before?.customerId);
    const nextCustomerId = str(after?.customerId);

    // 投影が有効な状態か（doc 存在＋未取消＋担当あり）
    const beforeActive = !!(before && before.voided !== true && prevCast);
    const afterActive = !!(after && after.voided !== true && nextCast);

    // 旧投影の除去: after が無効化された、または投影先（担当/顧客）が変わったとき
    if (beforeActive) {
      const sameTarget = afterActive && prevCast === nextCast && prevCustomerId === nextCustomerId;
      if (!sameTarget) await removeProjection(prevCast as string, prevCustomerId, saleId);
    }

    if (!afterActive) return;
    if (!(await isRealAccount(nextCast as string))) return;

    await writeProjection(shopId, nextCast as string, nextCustomerId, saleId, after as SaleData);
  },
);
