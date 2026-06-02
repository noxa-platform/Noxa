/**
 * 完全匿名の表示用 ID 生成。
 *
 * uid + スレッド ID から短い英数字を導出する。これにより
 *  - 同一スレッド内では同じ人＝同じ ID（会話を追える）
 *  - スレッドが違えば別 ID（投稿者の名寄せを防ぐ）
 * 内部 uid は一切表に出さない（一方向ハッシュ）。5ch の日替わり ID 的な役割。
 */

// djb2 ベースの簡易ハッシュ（暗号用途ではない。表示 ID の分散が目的）
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** スレッド内で安定した 4 桁の匿名 ID（16 進） */
export function anonId(uid: string, threadId: string): string {
  return (hash(`${uid}::${threadId}`) % 0xffff).toString(16).padStart(4, '0');
}
