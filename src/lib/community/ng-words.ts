/**
 * NG ワード検出（投稿前の警告ダイアログ用）。
 *
 * 仕様（正本 F4）: 違法行為 / 連絡先交換 / 改正風営法 NG ワード等を検出し、
 * 「規約違反の可能性があります。続けますか？」で投稿責任を本人に分散する。
 * モック用の最小セット。実装時は店舗名リスト・連絡先正規表現・運営管理リストへ拡張。
 */

export const NG_WORDS: readonly string[] = [
  '援交', '売春', '枕', '未成年',
  'LINE', 'line', 'ライン交換', '連絡先', '電話番号',
  'No.1', '億プレイヤー',
];

/** text に含まれる NG ワードを返す（大文字小文字を無視） */
export function findNgWords(text: string): string[] {
  const lower = text.toLowerCase();
  return NG_WORDS.filter((w) => lower.includes(w.toLowerCase()));
}
