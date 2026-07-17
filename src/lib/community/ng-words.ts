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
// ※ 'line id' は単純部分一致だと "online identity" / "online idea" まで誤ブロックするため、
//   語境界を見る CONTACT_PATTERNS の 'LINE ID' へ移した（真陽性は落とさない）。
const HARD_WORDS: readonly string[] = [
  '援交', '売春', '枕営業', '未成年', '児童', '児童買春',
  'ライン交換', 'らいん交換', 'line交換', 'カカオ', 'テレグラム', '連絡先交換',
];

// 連絡先パターン（ブロック）
// 区切り文字は NFKC 後の半角を対象にする（全角は checkNg 側の正規化で寄せ済み）。
const PHONE_SEP = '[-‐.・_ ]?';

const CONTACT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'URL', re: /https?:\/\/[^\s]+/i },
  { label: 'メールアドレス', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  // 電話番号: 0始まり／+81（国際表記）。区切りは -・._ と空白を許容する。
  // 旧実装は区切りが「-‐ 」のみで、"090.1234.5678" や "090・1234・5678"、
  // "+81 90 1234 5678" が素通りしていた。
  { label: '電話番号', re: new RegExp(`(\\+81|0)${PHONE_SEP}\\d{1,3}${PHONE_SEP}\\d{2,4}${PHONE_SEP}\\d{3,4}`) },
  // スキーム無しのメッセンジャー/SNS リンク（"line.me/ti/p/..." 等は URL パターンを素通りする）。
  // ドメイン限定なので誤検知は起きにくい。先頭は語境界（"online.me" を拾わない）。
  {
    label: '連絡先リンク',
    re: /(^|[^\w.])(line\.me|t\.me|open\.kakao\.com|instagram\.com|twitter\.com|x\.com)\//i,
  },
  // LINE ID の提示（"LINE ID 教えて" / "line@..." / "line:xxx"）。
  // 直前が英数字なら語の途中＝誤検知（"online id..."）なので除外する。
  { label: 'LINE ID', re: /(^|[^a-z0-9])line\s*(id|@|:)/i },
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
  // NFKC 正規化で全角→半角に寄せる。これをしないと全角入力（例: 電話「０９０…」・
  // 「ＬＩＮＥ交換」・全角「＠」）が半角前提の \d やワード一致を素通りし、
  // 連絡先交換ブロックを全角で回避できてしまう（半角入力には非破壊＝既存挙動は不変）。
  const normalized = text.normalize('NFKC');
  const lower = normalized.toLowerCase();
  const hard = new Set<string>();
  const soft = new Set<string>();

  for (const w of HARD_WORDS) if (lower.includes(w.toLowerCase())) hard.add(w);
  for (const { label, re } of CONTACT_PATTERNS) if (re.test(normalized)) hard.add(label);
  for (const w of SOFT_WORDS) if (lower.includes(w.toLowerCase())) soft.add(w);

  return { hard: [...hard], soft: [...soft] };
}
