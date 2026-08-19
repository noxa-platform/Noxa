/**
 * 夜職の実務語彙を「概念」として固定する層（Day126・純関数）。
 *
 * 店舗ごとに**同じ言葉が別の意味**を持つのがこの業界の最大の落とし穴で、
 * 用語の違いは「呼び名の違い」ではなく「**意味（判定規則）の違い**」が本体になる。
 *
 *   A 店: その日その客が最初に指名した 1 人が「本指名」
 *   B 店: 前回来店から同じ担当が続いていれば「本指名」（初回は場内）
 *
 * 呼び名は 3 店とも「本指名」で同じなのに、数え方が違う＝指名料もバックも変わる。
 * 呼び名の対応表だけを持つと、この 3 店を同じものとして集計して**金銭事故**になる。
 *
 * そこで 3 層に分ける:
 *   ① 概念 ID（不変・このファイル）      … nominationPrimary
 *   ② 呼び名（店ごと・shopConfig.terminology） … 「本指名」「本カラ」
 *   ③ 判定規則（店ごと・nomination-rule.ts）   … 何をもって本指名とするか
 *
 * ID は**保存値**なので変更しないこと（既存データとの互換が壊れる）。
 */

/** 概念 ID。用語辞書のキーはこの型に閉じる（Record<string,string> だと typo が素通りする） */
export type ConceptId =
  | 'cast'              // 接客する人
  | 'displayName'       // 源氏名
  | 'customer'          // お客様
  | 'table'             // 卓
  | 'checkout'          // 会計
  | 'nomination'        // 指名（総称）
  | 'nominationPrimary' // 本指名
  | 'nominationInhouse' // 場内指名
  | 'nominationFree'    // フリー（担当なし）
  | 'dohan'             // 同伴
  | 'extension'         // 延長
  | 'escortHome'        // 送り
  | 'closingRound'      // 締め
  | 'restart';          // 飲み直し（同じ客で伝票を切り直す）

/** 概念の既定の呼び名（夜職一般）。店舗・業種で上書きされる */
export const CONCEPT_DEFAULT_TERMS: Record<ConceptId, string> = {
  cast: 'キャスト',
  displayName: '源氏名',
  customer: 'お客様',
  table: '卓',
  checkout: '会計',
  nomination: '指名',
  nominationPrimary: '本指名',
  nominationInhouse: '場内指名',
  nominationFree: 'フリー',
  dohan: '同伴',
  extension: '延長',
  escortHome: '送り',
  closingRound: '締め',
  restart: '飲み直し',
};

/**
 * 概念の意味（AI と設定画面が読む説明文）。
 *
 * AI には**必ずこの概念 ID で考えさせ**、入出力のときだけ店舗の呼び名へ翻訳する。
 * 辞書に無い言葉を推測で解釈させないこと——用語の取り違えは金額と給与に直結する
 * （「確認できないことを断定しない」という今週の原則の、語彙版）。
 */
export const CONCEPT_DESCRIPTIONS: Record<ConceptId, string> = {
  cast: '客席で接客する従業員。',
  displayName: '客に対して名乗る名前。本名とは別に持つ。',
  customer: '来店する客。',
  table: '客が着く席の単位。',
  checkout: '伝票を締めて売上として記録する操作。',
  nomination: '客が特定の従業員を指名すること全般（本指名・場内の総称）。',
  nominationPrimary: '客がその従業員を目当てに来た指名。指名料とバックの対象になる。判定基準は店舗ごとに異なる。',
  nominationInhouse: '来店後に店内で担当が付いた指名。本指名とは料率が異なるのが一般的。',
  nominationFree: '担当が付いていない状態。',
  dohan: '来店前に従業員と合流して一緒に入店すること。',
  extension: '規定のセット時間を超えて延長すること。',
  escortHome: '退店する客を送ること。',
  closingRound: '営業終了間際の締めの一杯・締めの会計。店舗によって指す対象が異なる。',
  restart: '同じ客がそのまま新しいセットを始めること。売上・セット時間・指名の数え方に影響する。',
};

/** 概念 ID かどうか（保存データや AI 出力の検証用） */
export function isConceptId(v: unknown): v is ConceptId {
  return typeof v === 'string' && v in CONCEPT_DEFAULT_TERMS;
}

export const ALL_CONCEPT_IDS = Object.keys(CONCEPT_DEFAULT_TERMS) as ConceptId[];
