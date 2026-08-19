/**
 * 「この記録はどの店のものか」＝**出所（scope）**の判定（P128・純関数）。
 *
 * NOXA の「モデルA」は、キャストの顧客・売上の**正本を店舗ではなく個人**に置く
 * （`personal_customers/{castUid}` / `personal_sales/{castUid}`）。辞めても個人の履歴が
 * 残るための設計で、ここは正しい。問題は**読み手**にある。
 *
 * オーナー向けの俯瞰画面（キャスト別成績・担当顧客一覧）は、この個人台帳を
 * Admin SDK で読む。台帳は「そのキャストの全部」であって「当店の分」ではないのに、
 * 絞り込みを一度も掛けていなかった。キャストの掛け持ちはこの業界の標準なので、
 * これは例外ではなく既定の状態:
 *   - 他店の売上が当店の月間売上・組数・日次内訳に足される（給与査定の材料）
 *   - 個人ワークスペースで本人が付けた副業の売上まで足される
 *   - **他店で作られた顧客の氏名・累計売上がオーナーに見える**（数字のズレではなく漏洩）
 *
 * そこで判定を 1 か所に寄せる。原則は Day123 の「出所を見ずに既定へ倒さない」の裏返しで、
 * **当店由来だと確認できたものだけを当店に数える**。
 *
 * 「出所不明」を当店に倒さない理由:
 *   投影を書く CF は最初から `shopId` / `assignedFromShopId` を刻んでいる（sales-sync）。
 *   つまり出所が無い doc は「読めなかった」のではなく、**店を経由せず個人が作った記録**
 *   （個人ワークスペースの手入力売上・自分で登録した客）だと分かる。これを当店に数えるのは
 *   単なる誤集計ではなく、本人の副業の数字を店の成績表に載せることになる。
 *
 * 逆に、除外した件数を**キャスト個別には出さない**。「他店の台帳が N 件あります」は
 * 掛け持ち先の存在の露見で、漏洩を別の漏洩に置き換えるだけになる。
 * 画面には範囲の定義（当店由来のみ）を固定文言で書く。
 * ——「読めなかった（incomplete）」と「範囲外（scope）」は別物で、前者だけ件数を出す。
 */

/** 出所を持ち得る記録（売上・来店ログ・担当台帳） */
export type ShopScopedRecord = {
  /** 売上・来店ログ側の出所（`shop_shops/{shopId}/sales` からの投影が書く） */
  shopId?: unknown;
  /** 担当台帳（顧客 doc）側の出所（投影の新規作成・`assign-customer` が書く） */
  assignedFromShopId?: unknown;
};

/** 空白のみを除いた文字列。出所として使えない値は null */
function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * 記録の出所（店舗 ID）。確認できなければ null。
 * 売上・ログは `shopId`、担当台帳は `assignedFromShopId` に入る。
 */
export function recordShopId(record: ShopScopedRecord | null | undefined): string | null {
  if (!record) return null;
  return cleanId(record.shopId) ?? cleanId(record.assignedFromShopId);
}

/**
 * その記録が当店のものだと**確認できる**か。
 * 出所が無い（個人が店を経由せず作った）記録は false。
 */
export function belongsToShop(record: ShopScopedRecord | null | undefined, shopId: string): boolean {
  const target = cleanId(shopId);
  if (!target) return false; // 呼び出し側が店舗を確定できていない状態で全件を通さない
  return recordShopId(record) === target;
}

/** 出所が記録されていない（＝店を経由していない個人の記録） */
export function isUnscoped(record: ShopScopedRecord | null | undefined): boolean {
  return recordShopId(record) === null;
}

/**
 * 当店由来のものだけを残す。`get` は doc から生データを取り出す関数
 * （Firestore の QueryDocumentSnapshot をそのまま渡せるようにするため）。
 */
export function filterByShop<T>(
  items: readonly T[],
  shopId: string,
  get: (item: T) => ShopScopedRecord | null | undefined,
): T[] {
  return items.filter((item) => belongsToShop(get(item), shopId));
}

/**
 * 集計範囲の説明文（画面・API レスポンス共通）。
 * 数字が「当店の分だけ」であることを受け手が読める形で必ず添える。
 */
export const SHOP_SCOPE_NOTE =
  '集計は当店を経由した記録のみです（キャストが他店・個人で付けた売上や顧客は含みません）。';
