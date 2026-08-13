/**
 * 権限で閉じたときの案内文（Day114・純ロジック）。
 *
 * 軸は「**ゲートで閉じた後に、その利用者にとっての次の一手があるか**」。
 * 実際に見つかった穴は 2 種類とも「文言そのものが行き止まりを作る」形だった:
 *
 *   1. **できない操作を指示する**: 売上取消で未収の削除に失敗したとき
 *      「売掛管理から削除してください」と案内していたが、売掛管理は売上編集権限
 *      （owner/manager/accounting）が要る＝**案内先を開けない**。権限が無いと分かっている
 *      相手に自己解決を指示してはいけない。誰に頼むかを出す。
 *   2. **実態より狭く言い切る**: 売掛・リスク客の拒否文言が「このモジュールはオーナー専用です」
 *      だったが、UI も rules（`isShopMemberWithSalesEdit`）も owner/manager/accounting を許可している。
 *      店長・経理が「自分には無理」と諦め、役割の設定漏れが放置される。
 *
 * 文言だけを持つ（権限判定そのものは useShopRole / shop-role-state）。許可は一切広げない。
 */

/**
 * 売上編集権限を持つロール（オーナーは常に含むため列挙しない）。
 * rules の `isShopMemberWithSalesEdit`（unpaid / risk_customers / payments / daily_close_rows）と同基準。
 * ここを変えるときは firestore.rules も揃えること（test/lib/permission-guidance.test.ts が照合する）。
 */
export const SALES_EDIT_ROLES: readonly string[] = ['manager', 'accounting'];

/** 上記ロールの日本語表記（拒否文言で実態どおりに見せるため） */
export const SALES_EDIT_ROLE_LABEL = 'オーナー・店長・経理';

/**
 * 売上編集権限が要るモジュールを開けなかったときの案内。
 * 「オーナー専用」と言い切らず、**役割を付けてもらえば開ける**ことを伝える。
 */
export function describeSalesEditDenied(moduleLabel: string): string {
  return `${moduleLabel}は${SALES_EDIT_ROLE_LABEL}のみが利用できます。必要な場合はオーナーに役割の設定を依頼してください。`;
}

/**
 * 自分の権限では完了できない後始末の案内。
 * **その利用者が開けない画面へ誘導しない**（＝「〜から削除してください」と書かない）。
 */
export function describeDelegateRequest(action: string): string {
  return `${SALES_EDIT_ROLE_LABEL}のいずれかに、${action}を依頼してください。`;
}

/** オーナーだけが持つ設定（料金・メニュー等）を、在籍スタッフが開いたときの案内。 */
export function describeOwnerSettingDenied(settingLabel: string): string {
  return `${settingLabel}の設定はオーナー専用です。変更が必要なときはお店のオーナーに依頼してください。`;
}
