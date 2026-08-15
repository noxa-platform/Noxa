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

/** 所属（招待で参加した側）で店舗運営の通知を受け取る role */
const MANAGING_ROLES = ['owner', 'manager'];

/**
 * uid が通知の判定対象にできるワークスペースを返す（Day120）。
 * - shop_shops で ownerUid == uid（所有店舗）
 * - `account_users/{uid}/memberships` のうち role が owner/manager で在籍中のもの（所属店舗）
 * - 末尾に「MyDeck (personal)」として uid 自身
 *
 * Day120 の実バグ: 旧実装は **ownerUid の店舗しか見ていなかった**。招待で参加した店長は
 * rules 上その店舗の顧客カルテを read/write できる（`isShopMember` で全許可）のに、
 * 誕生日・次回アクション・ご無沙汰の通知が一度も来なかった。さらに日次サマリは
 * 無条件送信のため、店長には毎朝「前日: ¥0 / 0 組 / 今日の予定: 0 件」という
 * **もっともらしい 0**（データが無いのではなく見ている場所が違う）が届いていた。
 *
 * キャスト・会計（レジ端末）は所属では含めない。担当付き顧客は
 * `personal_customers/{castUid}/items`（＝MyDeck）が正本で従来どおり通知されるため、
 * 店舗側の「未担当バケット」まで全キャストへ配ると通知が増えるだけになる
 * （出す/出さないは product 判断＝LOG の要ユーザー項目）。
 */
export async function listUserWorkspaces(uid: string): Promise<WorkspaceLite[]> {
  // どちらかの読み取りに失敗したら握り潰さずに投げる。ここを `.catch(() => [])` で
  // 埋めると「所属店舗が無い人」と区別できず、店長には一生通知が来ない状態へ静かに戻る。
  const [shopsSnap, membershipsSnap] = await Promise.all([
    db().collection('shop_shops').where('ownerUid', '==', uid).get(),
    db().collection(`account_users/${uid}/memberships`).get(),
  ]);

  const shops: WorkspaceLite[] = shopsSnap.docs.map((d) => ({
    id: d.id,
    ownerUid: (d.data().ownerUid as string) ?? uid,
    name: d.data().name as string | undefined,
    type: 'business' as string | undefined,
  }));

  // 所有店舗にはオーナー自身の members doc（＝逆引き index）も並ぶので id で重複排除する
  const seen = new Set(shops.map((s) => s.id));
  for (const d of membershipsSnap.docs) {
    const data = d.data();
    const shopId = (data.shopId as string | undefined) ?? d.id;
    if (seen.has(shopId)) continue;
    const status = (data.status as string | undefined) ?? 'active';
    if (status !== 'active') continue; // 退店済みの残骸は対象外
    if (!MANAGING_ROLES.includes((data.role as string | undefined) ?? 'cast')) continue;
    seen.add(shopId);
    shops.push({
      id: shopId,
      name: (data.shopName as string | null | undefined) ?? undefined,
      type: 'business',
    });
  }

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
 * ワークスペースの顧客コレクションパス（純関数・Day121）。
 *
 * 旧実装は `shop_shops/{wid}` の**存在確認**で shop / personal を切り分けていた。
 * これは「引けなかった」を「個人ワークスペースだ」という別の結論に流用する形で、
 *   - 店舗が削除された後もメンバーの逆引き index が残っているとき（＝ゴースト店舗）
 *   - shop doc の read が一時的に失敗したとき
 * に `personal_customers/{shopId}/items` という**別の id 空間**を読みに行き、
 * 店舗の顧客を丸ごと見失って「0 件」を返す（Day120 で直した「毎朝 ¥0」がここから再発する）。
 * 種別は列挙側（`listUserWorkspaces`）が知っているので、判定させずに受け取る。
 */
export function customersCollectionPath(ws: WorkspaceLite): string {
  return ws.type === 'personal'
    ? `personal_customers/${ws.id}/items`
    : `shop_shops/${ws.id}/customers`;
}

/** ワークスペース内の全 customer を返す (Lite) */
export async function listCustomers(ws: WorkspaceLite): Promise<CustomerLite[]> {
  const collectionPath = customersCollectionPath(ws);
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

/** ワークスペース内の指定期間の logs */
export async function listLogsInRange(
  ws: WorkspaceLite,
  start: Date,
  end: Date,
): Promise<ContactLogLite[]> {
  const collectionPath = customersCollectionPath(ws);
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
