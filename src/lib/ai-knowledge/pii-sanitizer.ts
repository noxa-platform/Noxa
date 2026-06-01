/**
 * PII 除去ユーティリティ
 *
 * AI 生成物を匿名化集合学習に供する前に、個人・顧客・店舗を特定できる
 * 情報を伏字化する。完璧な匿名化は不可能なので、多重防御として
 * 「固有情報の伏字化 + 原文非保存 + 構造特徴のみ抽出」を組み合わせる。
 *
 * 使い方:
 *   const clean = sanitizePii(rawText);        // 伏字化テキスト
 *   const features = extractStructuralFeatures(rawText); // 構造特徴のみ
 */

// 電話番号（日本国内の一般的なフォーマット）
const PHONE_RE = /(?:\+?81[-\s]?|0)(?:\d{1,4}[-\s]?){1,3}\d{3,4}/g;

// メールアドレス
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// URL
const URL_RE = /https?:\/\/[^\s"'<>]+/g;

// LINE ID / SNS ID（@から始まる英数字、最低4文字）
const SOCIAL_ID_RE = /@[A-Za-z0-9_.-]{3,}/g;

// 金額表現（¥や円、万円、千円）
const MONEY_RE = /(¥|￥)?\s?\d{1,3}(,\d{3})+(円|万円|千円)?|\d+(\.\d+)?(万円|千円|円)/g;

// 日付（2024年5月10日、5月12日、5/12 等、年なしもカバー）
const DATE_SPECIFIC_RE = /(\d{2,4}年\s?)?\d{1,2}月\s?\d{1,2}日|\d{2,4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\/\d{1,2}/g;

// 時刻（21:30、21時30分）
const TIME_RE = /\d{1,2}[:時]\d{1,2}分?/g;

// 地名っぽいワード（都道府県・政令市＋主要駅名）は伏字化対象が広すぎるため、
// 代わりに「〇〇駅」「〇〇区」「〇〇市」パターンを検出
const LOCATION_RE = /[一-龠ぁ-んァ-ヶ]{1,6}(駅|市|区|町|村|丁目|番地)/g;

// 日本人氏名候補（2〜4文字の漢字 or カタカナ）: 誤検出多めなので接尾辞とのペアで限定
const NAME_RE = /([一-龠]{2,4}|[ァ-ヶ]{2,5})(さん|くん|ちゃん|様|君|氏|先生|社長|部長|店長)/g;

// 店舗名候補（「〇〇店」「〇〇クラブ」「〇〇ラウンジ」等）
// ※ 接頭辞が「お」「この」「その」等の一般的な代名詞・冠詞は除外して過剰マッチを防ぐ
const STORE_NAME_RE = /(?<![お御そこあど])[一-龠ァ-ヶA-Za-z0-9]{2,10}(店|クラブ|ラウンジ|スナック)/g;

/**
 * PII を伏字化して返す
 */
export function sanitizePii(text: string): string {
  if (!text) return '';

  return text
    .replace(URL_RE, '[URL]')
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(SOCIAL_ID_RE, '[SOCIAL_ID]')
    .replace(MONEY_RE, '[MONEY]')
    .replace(DATE_SPECIFIC_RE, '[DATE]')
    .replace(TIME_RE, '[TIME]')
    .replace(LOCATION_RE, '[PLACE]')
    .replace(STORE_NAME_RE, '[STORE]')
    .replace(NAME_RE, '[NAME]さん');
}

/**
 * 返信の構造特徴のみを抽出（原文は破棄）
 * - 文字数・文数・絵文字密度・質問形の有無・改行密度
 * - 先頭の話題・末尾の話題の方向性
 */
export interface StructuralFeatures {
  length: number;                 // 文字数
  sentenceCount: number;          // 文の数
  emojiCount: number;             // 絵文字の数
  emojiLevel: 'none' | 'low' | 'mid' | 'high';
  hasQuestion: boolean;           // 「？」が含まれる
  hasApology: boolean;            // 謝罪語彙
  hasAppreciation: boolean;       // 感謝語彙
  hasInvitation: boolean;         // 誘い語彙
  hasFutureReference: boolean;    // 「今度」「次回」等
  endsWithQuestion: boolean;      // 末尾が疑問
  exclamationCount: number;       // 「！」の数
  sentenceAvgLength: number;      // 1 文あたり平均文字数
}

// 絵文字の簡易カウント（サロゲートペア対応）
function countEmojis(text: string): number {
  // 基本的な絵文字範囲（絵文字プレゼンテーション含む）
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F900}-\u{1F9FF}]/gu;
  return (text.match(emojiRe) || []).length;
}

function detectEmojiLevel(count: number, length: number): 'none' | 'low' | 'mid' | 'high' {
  if (count === 0) return 'none';
  const density = count / Math.max(length, 1);
  if (density < 0.02) return 'low';
  if (density < 0.06) return 'mid';
  return 'high';
}

export function extractStructuralFeatures(text: string): StructuralFeatures {
  const t = text || '';
  const sentences = t.split(/[。.!?！？\n]+/).filter((s) => s.trim().length > 0);
  const emojiCount = countEmojis(t);
  const length = t.length;

  const hasApology = /ごめ|申し訳|すみません|ごめんなさい/.test(t);
  const hasAppreciation = /ありがと|感謝|嬉しい|うれしい/.test(t);
  const hasInvitation = /(来|きて|行|いこう|会|また|次).*(ね|よ|ませんか|ましょう|しよう)/.test(t);
  const hasFutureReference = /(今度|次回|次の|また今度|また会|また話)/.test(t);
  const endsWithQuestion = /[？?]\s*$/.test(t.trimEnd());
  const exclamationCount = (t.match(/[！!]/g) || []).length;

  return {
    length,
    sentenceCount: sentences.length,
    emojiCount,
    emojiLevel: detectEmojiLevel(emojiCount, length),
    hasQuestion: /[？?]/.test(t),
    hasApology,
    hasAppreciation,
    hasInvitation,
    hasFutureReference,
    endsWithQuestion,
    exclamationCount,
    sentenceAvgLength: sentences.length > 0 ? Math.round(length / sentences.length) : 0,
  };
}
