/**
 * AI への顧客 PII 送信ガード（純ロジック・Day12）。
 *
 * 方針（docs/ai-privacy-policy.md が正本）:
 *   1. 連絡先系フィールド（電話・メール・住所・LINE ID 等）は AI プロンプトに載せない
 *      → allowlist 方式（pickForAi）。Firestore doc の丸ごと送信を禁止する。
 *   2. フリーテキスト（メモ・好み等）に書かれた電話番号/メールは機械マスク（maskContactInfo）。
 *      LINE ID や住所は機械検出が困難（誤爆リスク）なため、ポリシー文書で運用注意とする。
 *   3. 氏名は接客 AI の中核文脈のため送る（源氏名/ニックネーム推奨を UI 文言で促す）。
 */

/** AI 機能の初回利用時に表示する同意文言（docs/ai-privacy-policy.md の文言案と同一） */
export const AI_CONSENT_TEXT =
  'AI 機能は、顧客メモ・来店履歴などの情報を AI サービス（外部 API）に送信して提案を生成します。'
  + '電話番号・メールアドレスは自動的に伏せ字にされますが、メモにはお客様の本名・住所・LINE ID を書かないことをおすすめします。';

/** 顧客 doc から AI に渡してよいフィールド（接客文脈に必要な最小集合） */
export const AI_CUSTOMER_FIELDS = [
  'name', 'rank', 'tags', 'totalSales', 'visitCount', 'lastContactAt', 'birthday',
  'likesNote', 'dislikesNote', 'ngNote', 'importantMemo', 'memo', 'notes',
  'mbti', 'personalityTraits', 'interests', 'triggerPositive', 'triggerNegative',
  'communicationStyle', 'customerPersonality', 'myMessageStyle',
] as const;

/** 来店ログから AI に渡してよいフィールド */
export const AI_LOG_FIELDS = ['type', 'date', 'datetime', 'salesAmount', 'memo', 'note', 'countAsGroup'] as const;

// 日本の電話番号（0始まり10-11桁・区切りはハイフン/空白/長音「ー」/各種ダッシュ類/ドット・中黒・
// アンダースコアを許容・+81 形式）。U+2212(−)・U+2010(‐)・U+2015(―) は NFKC 正規化でも '-' に
// ならないため個別に含める。ドット/中黒/アンダースコア(例: 090.1234.5678・090・1234・5678)は
// 10桁ガードと併用しても日付/金額の誤爆を招かない（0 または +81 始まり計10桁以上に限るため）。
const PHONE_SEP = '[-\\sー−‐―.・_]';
const PHONE_RE = new RegExp(`(?:\\+81${PHONE_SEP}?|0)\\d{1,4}${PHONE_SEP}?\\d{1,4}${PHONE_SEP}?\\d{3,4}(?!\\d)`, 'g');
// メールアドレス（一般形）
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * フリーテキスト中の電話番号・メールアドレスをマスクする。
 * 数値の誤爆を抑えるため、電話は「0 または +81 始まり・計10桁以上」のみ対象
 * （金額・日付・時刻・％等は対象外になる）。
 * 全角入力（０９０−１２３４…・＠）を取りこぼさないよう NFKC 正規化してから検出する
 * （AI 送信用テキストの変換なので、正規化された文字列を返してよい）。
 */
export function maskContactInfo(text: string): string {
  return text
    .normalize('NFKC')
    .replace(EMAIL_RE, '[メール非表示]')
    .replace(PHONE_RE, (m) => {
      const digits = m.replace(/\D/g, '');
      // 10桁未満（内線・単なる数値）はマスクしない
      return digits.length >= 10 ? '[電話番号非表示]' : m;
    });
}

/** 値を再帰的に走査し、すべての文字列に maskContactInfo を適用する */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskContactInfo(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    // Timestamp 等のクラスインスタンスは走査しない（toMillis を壊さない）
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v);
    return out as unknown as T;
  }
  return value;
}

/**
 * allowlist 抽出＋マスク。Firestore doc を AI プロンプトへ載せる直前に必ず通す。
 * allowlist に無いフィールド（電話・メール・住所・自由拡張フィールド）は落ちる。
 */
export function pickForAi(
  data: Record<string, unknown> | undefined | null,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data) return out;
  for (const f of fields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') continue;
    out[f] = maskDeep(data[f]);
  }
  return out;
}
