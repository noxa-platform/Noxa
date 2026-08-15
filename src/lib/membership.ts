/**
 * 「その店舗に所属しているか」の単一判定（純関数・Day122）。
 *
 * 所属の正本は `shop_shops/{shopId}/members/{uid}`。クライアントはそれを直接引けないので、
 * Cloud Functions が同期する逆引き index `account_users/{uid}/memberships/{shopId}` を読む。
 *
 * Day122 の問題: **同じ index を、サーバとクライアントが別々の基準で読んでいた**。
 *   - CF（通知）: `status === 'active'` で絞り、店舗が実在するかも確認する（Day120・Day121-PM）
 *   - クライアント: 8 箇所すべてが `snap.docs.map((d) => d.id)`（status も生存も見ない）
 * 片方だけが「所属している」と判断する状態は、退店済みのスタッフに店舗 UI が出たまま
 * 通知だけ来ない（またはその逆）という、どちらが正しいか誰にも分からない食い違いになる。
 * 判定はここに 1 本化し、CF 側（`functions/src/lib/workspaces.ts`）と既定を揃える。
 *
 * 既定値の扱い: `status` 未設定は **在籍中**（CF の `syncMembershipIndex` が
 * `status: after.status ?? 'active'` と書くのと同じ既定）。旧 doc に status が無いだけで
 * 所属が消えると、招待で参加済みのスタッフから店舗 UI が丸ごと消える。
 */

/** 逆引き index の snapshot（`{ id, data() }` を持つものなら何でも受ける） */
export interface MembershipSnapshotLike {
  id: string;
  data: () => { status?: unknown; role?: unknown; shopName?: unknown; shopId?: unknown } | undefined;
}

/** index に載る所属（表示にも使う最小形） */
export interface MembershipItem {
  id: string;
  /** CF が denormalize した店舗名。未設定なら呼び出し側でフォールバックする */
  name?: string;
  role?: string;
}

export const ACTIVE_STATUS = 'active';

/** 在籍中か（status 未設定は在籍として扱う＝CF の既定と同じ） */
export function isActiveMembership(data: { status?: unknown } | undefined): boolean {
  const status = typeof data?.status === 'string' ? data.status : undefined;
  return (status ?? ACTIVE_STATUS) === ACTIVE_STATUS;
}

/** 在籍中の所属だけを取り出す */
export function activeMemberships(docs: readonly MembershipSnapshotLike[]): MembershipItem[] {
  const items: MembershipItem[] = [];
  for (const d of docs) {
    const data = d.data();
    if (!isActiveMembership(data)) continue;
    items.push({
      id: typeof data?.shopId === 'string' ? data.shopId : d.id,
      name: typeof data?.shopName === 'string' && data.shopName ? data.shopName : undefined,
      role: typeof data?.role === 'string' ? data.role : undefined,
    });
  }
  return items;
}

/**
 * 逆引きに載っている店舗を切替リストに残すか（Day122）。
 *
 * 店舗を削除しても members サブコレクションは残るため、逆引き index には
 * **消えた店舗が残り続ける**（掃除トリガーは今後の削除にしか効かない・Day121）。
 * 消えた店を並べると選んだ瞬間に何も開けない行き止まりになるので落とす。
 * ただし **「確認できなかった」は落とす理由にしない**（通信断のたびに切替先が消え、
 * 個人ワークスペース選択中のユーザーが自分の店へ戻れなくなる・Day109/Day105）。
 *
 * @param shopExists true=実在 / false=削除済みと確認できた / null=確認できなかった
 */
export function keepMembershipWorkspace(shopExists: boolean | null): boolean {
  return shopExists !== false;
}

/** 在籍中の所属店舗 ID（shopId 解決に使う） */
export function activeMembershipIds(docs: readonly MembershipSnapshotLike[]): string[] {
  return activeMemberships(docs).map((m) => m.id);
}
