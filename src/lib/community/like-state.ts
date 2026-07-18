/**
 * いいね表示集合（likedIds）の遷移（純ロジック・単体テスト対象）。
 *
 * 楽観更新とその巻き戻しの両方で同じ遷移を使うため関数化する。
 * 「点ける/消す」を**非破壊**で適用し、常に新しい Set を返す
 * （React state は同一参照だと再描画されないため、必ず新インスタンス）。
 */

/** like キー集合に key を liked=true で追加 / false で削除した新しい Set を返す。 */
export function setLikeKey(prev: ReadonlySet<string>, key: string, liked: boolean): Set<string> {
  const next = new Set(prev);
  if (liked) next.add(key);
  else next.delete(key);
  return next;
}
