/**
 * NG 検出（2 段階）。
 *
 *  - hard（ブロック）: 違法・連絡先交換など、投稿させてはいけないもの。投稿不可。
 *      重大語（援交/売春/枕営業/未成年 等）＋ 連絡先パターン（URL/メール/電話/LINE交換等）。
 *  - soft（警告）: 改正風営法 NG ワード等。「規約違反の可能性。続けますか？」で続行可（本人責任）。
 *
 * モック用の最小セット。実装時は店舗名リスト・連絡先正規表現・運営管理リストへ拡張する。
 */

// 重大語（ブロック）
const HARD_WORDS: readonly string[] = [
  '援交', '売春', '枕営業', '未成年', '児童', '児童買春',
  'ライン交換', 'line交換', 'line id', 'カカオ', 'テレグラム', '連絡先交換',
];

// 連絡先パターン（ブロック）
const CONTACT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'URL', re: /https?:\/\/[^\s]+/i },
  { label: 'メールアドレス', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { label: '電話番号', re: /0\d{1,3}[-‐ ]?\d{2,4}[-‐ ]?\d{3,4}/ },
];

// 改正風営法ワード等（警告のみ・続行可）
const SOFT_WORDS: readonly string[] = [
  'no.1', 'ナンバーワン', '億プレイヤー', 'スカウトバック', '色恋営業',
];

export interface NgResult {
  hard: string[]; // ブロック対象のヒット
  soft: string[]; // 警告対象のヒット
}

/** text を判定。hard が空でなければ投稿不可、soft のみなら警告で続行可。 */
export function checkNg(text: string): NgResult {
  const lower = text.toLowerCase();
  const hard = new Set<string>();
  const soft = new Set<string>();

  for (const w of HARD_WORDS) if (lower.includes(w.toLowerCase())) hard.add(w);
  for (const { label, re } of CONTACT_PATTERNS) if (re.test(text)) hard.add(label);
  for (const w of SOFT_WORDS) if (lower.includes(w.toLowerCase())) soft.add(w);

  return { hard: [...hard], soft: [...soft] };
}
