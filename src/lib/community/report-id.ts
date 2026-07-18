/**
 * 通報 doc の決定的 ID（純ロジック・単体テスト対象）。
 *
 * ランダム ID（addDoc）だと同一ユーザーが同一対象を何度も通報でき、重複 doc が溜まる。
 * `kind_targetId_uid` で決定化し「1ユーザー1対象=1通報」にすることで、重複通報と
 * 生カウント（reportCount）の水増しを防ぐ（いいねの `uid_kind_targetId` と同じ設計）。
 * firestore.rules は create のみ許可のため、呼び出し側は既存チェックで冪等にする。
 */
export function reportDocId(kind: 'thread' | 'reply', targetId: string, uid: string): string {
  return `${kind}_${targetId}_${uid}`;
}
