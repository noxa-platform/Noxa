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
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

const REGION = 'asia-northeast1';

/**
 * account_users/{uid} が実在するか（端末/operator-only uid を投影対象から除外）。
 *
 * 読み取りに失敗したときに false を返してはいけない（Day118）。呼び出し側は false を
 * 「投影対象外の uid」と解釈して**売上の投影を丸ごと飛ばしたうえで正常終了**するため、
 * 一時障害・タイムアウトのたびに**キャストの個人売上と担当台帳が静かに欠ける**
 * （成績・給与の材料が欠けるのに、ログにも実行結果にも何も残らない）。
 * 確認できなかったときは throw して**関数の失敗として記録・再試行**させる。
 */
async function isRealAccount(uid: string): Promise<boolean> {
  try {
    return (await db().doc(`account_users/${uid}`).get()).exists;
  } catch (e) {
    logger.error('[syncShopSaleToPersonal] 投影対象の確認に失敗したため投影を保留する', { uid, error: String(e) });
    throw e;
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

/** 個人側へコピーする売上区分（本指名/場内/フリー・同伴・卓・客層）。会計時に POS が確定した値をそのまま控えへ写す。 */
function saleClassification(after: SaleData): Record<string, unknown> {
  return {
    nomination: str(after.nomination),          // 'main' | 'inTable' | 'free' | null（旧データ）
    dohan: after.dohan === true,
    customerType: str(after.customerType),      // 'initial' | 'regular' 等
    tableId: str(after.tableId),
    tableName: str(after.tableName),
  };
}

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
      // 既存台帳は差額のみ反映（再発火=0、金額修正=差額、初ログ=満額＋来店+1）。
      // 出所（assignedFromShopId）は**未記入のときだけ**補う（P128）。
      // オーナー向けの俯瞰は台帳をこのフィールドで当店分に絞るので、刻印が欠けた doc は
      // 当店の担当顧客数から静かに漏れる。作成経路（この関数と assign-customer）は
      // 最初から刻んでいるが、外部で作られた doc・統合で移ってきた doc など
      // 刻印の無い台帳が来店したときに拾えるようにする。
      // **既存の値は上書きしない**——客が担当キャストを追って別の店に来ても、
      // その台帳の出自は最初に渡した店のままにする（後から来た店が既存店の顧客数を奪わない）。
      const hasOrigin = typeof custSnap.data()?.assignedFromShopId === 'string'
        && (custSnap.data()?.assignedFromShopId as string).trim() !== '';
      tx.set(custRef, {
        totalSales: FieldValue.increment(amount - prevAmount),
        visitCount: FieldValue.increment(prevLogged ? 0 : 1),
        lastContactAt: datetime,
        mainCastUid: cast,
        ...(hasOrigin ? {} : { assignedFromShopId: shopId }),
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
      ...saleClassification(after),
      ...(prevLogged ? {} : { createdAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // 移行クリーンアップ: 同 saleId の personal_sales 控えが残っていれば除去（顧客あり↔なし切替/旧仕様分）。
  // ここが黙って失敗すると顧客ログと personal_sales の**両方**が残り、member-stats が
  // 二重計上する（このファイルが冒頭で「排他にして二重計上を防ぐ」と書いている前提が崩れる）。
  // 投影自体は冪等なので、throw して再試行させるのが安全（Day118）。
  try {
    await personalSaleRef(cast, saleId).delete();
  } catch (e) {
    logger.error('[syncShopSaleToPersonal] 旧 personal_sales 控えの除去に失敗（二重計上の恐れ）', { cast, saleId, error: String(e) });
    throw e;
  }
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
  try {
    isNew = !(await ref.get()).exists;
  } catch (e) {
    // 読めなくても控えの upsert 自体は続ける（このあとの set が本命）。ただし無言にしない（Day118）
    logger.warn('[syncShopSaleToPersonal] 既存控えの確認に失敗（新規として続行）', { cast, saleId, error: String(e) });
    isNew = true;
  }
  const data: Record<string, unknown> = {
    shopId,
    shopSaleId: saleId,
    source: 'shop',
    entryMode: str(after.entryMode) ?? 'amount',
    salesAmount: num(after.amount),
    // 個人売上画面（SalesClient）は amount 表示＋ dayKey 範囲購読のため両方を控えに写す。
    // 旧実装はどちらも欠けており、POS会計の控えが個人売上画面に一切表示されなかった。
    amount: num(after.amount),
    dayKey: str(after.dayKey),
    datetime: after.checkoutAt ?? after.createdAt ?? FieldValue.serverTimestamp(),
    customerId: null,
    customerName: str(after.customerName),
    castName: str(after.castName),
    ...saleClassification(after),
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
    // 念のための掃除。失敗しても本体（顧客ログ）の除去は済んでいるので続行するが、無言にはしない
    await personalSaleRef(cast, saleId).delete().catch((e) => {
      logger.warn('[syncShopSaleToPersonal] 予備の personal_sales 控えの除去に失敗', { cast, saleId, error: String(e) });
    });
  } else {
    // 顧客なし売上の投影本体。ここが黙って失敗すると**取消・担当変更した売上が個人売上に残り続ける**
    // （本人の売上画面と member-stats に幻の売上が計上される）。throw して再試行させる（Day118）。
    try {
      await personalSaleRef(cast, saleId).delete();
    } catch (e) {
      logger.error('[syncShopSaleToPersonal] personal_sales 控えの除去に失敗（幻の売上が残る恐れ）', { cast, saleId, error: String(e) });
      throw e;
    }
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
