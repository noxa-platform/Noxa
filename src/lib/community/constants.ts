/**
 * コミュニティの定数（タグ統制語彙・板構成・ウェッジ設定・デザイントークン）。
 */

import type { AreaTag, JobTag } from './types';

export const AREA_TAGS: readonly AreaTag[] = ['関東', '関西', '東海', '九州', '北海道', 'その他'];
export const JOB_TAGS: readonly JobTag[] = ['ホスト', 'キャバ・ガルバ', 'ラウンジ・コンカフェ', '風俗'];

/**
 * 1 ウェッジ MVP のターゲット（大阪ミナミ × ホスト想定）。
 * シードの偏りや初期の絞り込みデフォルトに使う。go-to-market 上の設定値で、
 * コードは N 板・全エリアを汎用にサポートする。
 */
export const WEDGE = {
  areaTag: '関西' as AreaTag,
  jobTag: 'ホスト' as JobTag,
  label: '大阪ミナミ',
};

/** community = wine（デザインシステムの community tint） */
export const WINE = '#C4384A';
export const WINE_INK = '#E89AA6';

// デザイントークン（globals.css の CSS 変数を参照）
export const FONT = {
  mono: 'var(--noxa-font-mono)',
  jp: 'var(--noxa-font-sans-jp)',
  display: 'var(--noxa-font-display-jp)',
} as const;
