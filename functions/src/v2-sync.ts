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
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

setGlobalOptions({ region: 'asia-northeast1' });

/**
 * batch は 500 件上限。超えると commit 自体が落ちて**一件も反映されない**（Day121）。
 * メンバーの多い店舗で「名前だけ永久に古いまま」「消した店が全員に残ったまま」になるため、
 * 分割してコミットする。失敗は呼び出し側で記録して throw（再試行させる）。
 */
async function commitInChunks<T>(
  items: readonly T[],
  apply: (batch: ReturnType<ReturnType<typeof db>['batch']>, item: T) => void,
  onError: (from: number, error: unknown) => void,
  chunkSize = 400,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const batch = db().batch();
    for (const item of items.slice(i, i + chunkSize)) apply(batch, item);
    try {
      await batch.commit();
    } catch (e) {
      onError(i, e);
      throw e;
    }
  }
}

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
      // 削除。ここが黙って失敗すると**閉店・削除した店舗の公開ページが残り続ける**
      // （shop_public_profiles は誰でも読める）。失敗は記録して再試行させる（Day118）
      try {
        await publicRef.delete();
      } catch (e) {
        logger.error('[syncShopPublicProfile] 公開プロフィールの削除に失敗（公開されたまま残る）', { shopId, error: String(e) });
        throw e;
      }
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
      // ここが黙って失敗すると**退店したスタッフの所属が逆引きに残り続ける**
      // （ホームの店舗一覧・端末の許可モジュール判定がこの index を見る）。記録して再試行させる（Day118）
      try {
        await indexRef.delete();
      } catch (e) {
        logger.error('[syncMembershipIndex] 逆引き index の削除に失敗（退店者の所属が残る）', { shopId, uid, error: String(e) });
        throw e;
      }
      return;
    }

    // shop の名前を取得して denormalize (ホーム画面で名前表示用)
    let shopName: string | null = null;
    try {
      const shopSnap = await db().doc(`shop_shops/${shopId}`).get();
      shopName = (shopSnap.data()?.name as string | undefined) ?? null;
    } catch (e) {
      // 名前が引けないだけなら index は作る（表示が shopId になるだけ）。ただし無言にしない（Day118）
      logger.warn('[syncMembershipIndex] 店舗名の取得に失敗（shopName なしで続行）', { shopId, uid, error: String(e) });
    }

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
 * shop_shops/{shopId} 削除時、全メンバーの逆引き index を掃除する（Day121）。
 *
 * 逆引き index を消す経路は `members/{uid}` の削除トリガーしか無かった。ところが
 * **店舗 doc を消してもサブコレクション（members）は残る**ため、この経路は一度も発火しない。
 * 実際に `account/delete`（オーナー退会）は `shop_shops/{id}` だけを消して members を残す。
 * 結果、消えた店舗が全メンバーの逆引きに残り続け、
 *   - ホームの店舗切替に「開けない店」が並ぶ（Day114 型の行き止まり）
 *   - 共有端末の許可モジュール判定がこの index を見る（Day113）
 *   - 通知がその店舗を見に行く（Day120）
 * と、3 系統がゴーストを掴む。index は CF が持つ非正本の派生データなので、
 * 正本（members / customers）には触らずに index だけを実体に合わせる。
 */
export const cleanupMembershipIndexOnShopDelete = onDocumentWritten(
  'shop_shops/{shopId}',
  async (event) => {
    const shopId = event.params.shopId;
    // ここだけは**削除だと確認できたときにしか**動かさない（消す側の判定は厳しく取る）。
    // 他のトリガーは after が無ければ削除と見なすが、この関数は event.data 自体が
    // 欠けている異常系でも同じ結論になり、生きている店舗の逆引きを消し得た（Day121-PM）。
    if (!event.data) {
      logger.warn('[cleanupMembershipIndexOnShopDelete] イベントに変更データが無い（削除と断定せず中断）', { shopId });
      return;
    }
    if (event.data.after.data()) return; // 削除以外は対象外

    const membersSnap = await db().collection(`shop_shops/${shopId}/members`).get();
    if (membersSnap.empty) return;

    const uids = membersSnap.docs.map((d) => d.id);
    await commitInChunks(
      uids,
      (batch, uid) => batch.delete(db().doc(`account_users/${uid}/memberships/${shopId}`)),
      (from, error) => logger.error('[cleanupMembershipIndexOnShopDelete] 逆引き index の掃除に失敗（消した店舗が所属に残る）', { shopId, from, error: String(error) }),
    );
    logger.info('[cleanupMembershipIndexOnShopDelete] 削除済み店舗の逆引きを掃除', { shopId, count: uids.length });
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
    // 500 件上限で丸ごと落ちると、メンバーの多い店舗ほど**名前が永久に古いまま**になる（Day121）
    await commitInChunks(
      membersSnap.docs.map((m) => m.id),
      (batch, uid) => batch.set(
        db().doc(`account_users/${uid}/memberships/${shopId}`),
        { shopName: after.name ?? null, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      ),
      (from, error) => logger.error('[syncShopNameToMemberships] 店舗名の反映に失敗（所属一覧に古い名前が残る）', { shopId, from, error: String(error) }),
    );
  },
);
