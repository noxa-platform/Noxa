/**
 * v2 schema 対応版 (旧 crm_workspaces → shop_shops + personal_*)
 *
 * Cloud Functions 通知配信向けに、ユーザーが扱う「顧客カルテ」を列挙する。
 * v2 では:
 *   - Shop モード: shop_shops/{shopId}/customers
 *   - Personal モード: personal_customers/{uid}/items
 * の 2 箇所に分かれる。本ヘルパーは uid を渡すと両方を統合して扱えるよう抽象化する。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../admin';
import type { CustomerLite, ContactLogLite, WorkspaceLite } from '../types';

/**
 * uid が ownerUid の shop_shops + personal MyDeck を統合した一覧を返す。
 * - shop_shops で ownerUid == uid のもの
 * - 末尾に「MyDeck (personal)」として uid 自身を追加
 */
export async function listOwnedWorkspaces(uid: string): Promise<WorkspaceLite[]> {
  const shopsSnap = await db()
    .collection('shop_shops')
    .where('ownerUid', '==', uid)
    .get();
  const shops: WorkspaceLite[] = shopsSnap.docs.map((d) => ({
    id: d.id,
    ownerUid: (d.data().ownerUid as string) ?? uid,
    name: d.data().name as string | undefined,
    type: 'business' as string | undefined,
  }));
  // MyDeck (personal) を末尾に追加
  shops.push({
    id: uid,
    ownerUid: uid,
    name: 'MyDeck',
    type: 'personal',
  });
  return shops;
}

/**
 * wid 内の全 customer を返す (Lite)。
 * - shop_shops/{wid} が存在すれば Shop モード (shop_shops/{wid}/customers)
 * - 無ければ Personal モード (personal_customers/{wid}/items、wid = ownerUid と扱う)
 */
export async function listCustomers(wid: string): Promise<CustomerLite[]> {
  const collectionPath = await resolveCustomersCollection(wid);
  const snap = await db().collection(collectionPath).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: (data.name as string) ?? '名前未設定',
      birthday: (data.birthday as string | null) ?? null,
      lastContactAt: (data.lastContactAt as Timestamp | null) ?? null,
      totalSales: (data.totalSales as number) ?? 0,
      nextAction: (data.nextAction as string | null) ?? null,
      nextActionDue: (data.nextActionDue as Timestamp | null) ?? null,
    } satisfies CustomerLite;
  });
}

/** wid 内の指定期間の logs */
export async function listLogsInRange(
  wid: string,
  start: Date,
  end: Date,
): Promise<ContactLogLite[]> {
  const collectionPath = await resolveCustomersCollection(wid);
  const customersSnap = await db().collection(collectionPath).get();
  const logs: ContactLogLite[] = [];
  for (const cust of customersSnap.docs) {
    const logSnap = await db()
      .collection(`${collectionPath}/${cust.id}/logs`)
      .where('datetime', '>=', Timestamp.fromDate(start))
      .where('datetime', '<', Timestamp.fromDate(end))
      .get();
    logSnap.forEach((l) => {
      const data = l.data();
      logs.push({
        id: l.id,
        type: (data.type as string) ?? 'other',
        datetime: data.datetime as Timestamp,
        salesAmount: (data.salesAmount as number) ?? 0,
        countAsGroup: (data.countAsGroup as boolean | null | undefined) ?? null,
      });
    });
  }
  return logs;
}

/** wid を見て shop or personal を判定し customers コレクションパスを返す */
async function resolveCustomersCollection(wid: string): Promise<string> {
  const shopDoc = await db().collection('shop_shops').doc(wid).get();
  if (shopDoc.exists) return `shop_shops/${wid}/customers`;
  return `personal_customers/${wid}/items`;
}
