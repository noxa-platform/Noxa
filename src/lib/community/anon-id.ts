/**
 * 完全匿名の表示用 ID 生成（日替わり・板単位 / 5ch 風）。
 *
 * uid + 板ID + 日付 から短い英数字を導出する。これにより
 *  - 同じ日・同じ板の中では同じ人＝同じ ID（会話を追える・自演を見抜ける）
 *  - 日が変われば別 ID（永続的な名寄せを防ぐ）
 *  - 板が違えば別 ID
 * 内部 uid は一切表に出さない（一方向ハッシュ）。
 * モデレーション・開示請求は内部 authorUid で行う（ID とは別系統）。
 */

// djb2 ベースの簡易ハッシュ（暗号用途ではない。表示 ID の分散が目的）
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** ミリ秒から JST 基準の日付キー（YYYY-MM-DD）。深夜帯の日付境界を JST に合わせる。 */
export function dayKeyFromMillis(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 今日（JST）の日付キー */
export function todayKey(): string {
  return dayKeyFromMillis(Date.now());
}

/** 日替わり・板単位で安定した 4 桁の匿名 ID（16 進） */
export function anonId(uid: string, boardId: string, dayKey: string): string {
  return (hash(`${uid}::${boardId}::${dayKey}`) % 0xffff).toString(16).padStart(4, '0');
}
