/**
 * POS 会計 → 未収（売掛）起票の純ロジック（Day8: 金の流れの一気通貫）。
 *
 * 旧運用は未収が完全手入力の別台帳（unpaid）で、POS 会計と二重管理だった。
 * 会計トランザクション内でこの関数が作る entry を unpaid へ同時起票し、
 * 「ツケ会計→未収一覧→回収」の流れを1本に繋ぐ。
 * 書込権限は rules の isShopMemberWithSalesEdit（owner/manager/accounting）のまま
 * 変更しない。UI 側で同ロールにのみツケ入力を出す。
 */

export type UnpaidEntryInput = {
  customerName?: string | null;
  castName?: string | null;
  tableName?: string;
  slipName?: string;
  /** 会計の確定総額 */
  totalAmount: number;
  /** うち未収（ツケ）額 */
  unpaidAmount: number;
  /** 営業日キー（YYYY-MM-DD） */
  dayKey: string;
  /** 紐付く sales doc の id（回収時の突合用） */
  saleId: string;
  operatorUid: string;
};

/**
 * unpaid ドキュメント本体を作る。無効な入力（0以下・総額超え）は null＝起票しない。
 * フィールドは既存の手入力台帳（UnpaidClient）と同スキーマ＋出所(source/saleId)。
 */
export function buildUnpaidEntry(input: UnpaidEntryInput): Record<string, unknown> | null {
  const unpaid = Math.floor(input.unpaidAmount);
  const total = Math.floor(input.totalAmount);
  if (!Number.isFinite(unpaid) || unpaid <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const amount = Math.min(unpaid, total); // 未収がなぜか総額を超えていたら総額に丸める
  const parts = [
    `POS会計`,
    input.tableName ? `卓${input.tableName}` : null,
    input.slipName ? `伝票${input.slipName}` : null,
    `総額¥${total.toLocaleString('ja-JP')}`,
    input.castName ? `担当${input.castName}` : null,
  ].filter(Boolean);
  return {
    customerName: (input.customerName ?? '').trim() || '（名無し）',
    amount,
    paidAmount: 0,
    date: input.dayKey,
    status: '未回収',
    memo: parts.join(' '),
    source: 'pos',
    saleId: input.saleId,
    createdBy: input.operatorUid,
  };
}
