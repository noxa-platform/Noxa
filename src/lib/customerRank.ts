/**
 * 顧客ランク（iOS/yorulog の正データに一致＝SS/S/A/B/C）。
 * UIは★5段階で表示・入力する（SS=★5 / S=★4 / A=★3 / B=★2 / C=★1）。
 * データは rank 文字列のまま保存（新フィールドは作らない）。
 */
export const CUSTOMER_RANKS = ['SS', 'S', 'A', 'B', 'C'] as const;
export type CustomerRank = (typeof CUSTOMER_RANKS)[number];

/** rank → 星数（SS=5 … C=1、未設定=0） */
export function rankToStars(rank?: string | null): number {
  const i = CUSTOMER_RANKS.indexOf(rank as CustomerRank);
  return i < 0 ? 0 : 5 - i;
}

/** 星数 → rank（5=SS … 1=C、0=未設定） */
export function starsToRank(stars: number): CustomerRank | '' {
  if (stars < 1 || stars > 5) return '';
  return CUSTOMER_RANKS[5 - stars];
}
