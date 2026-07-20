/**
 * 売上ログの集計ルール（firebase 非依存・単一ソース・Day58）。
 *
 * 「このログを組数(来店組数)としてカウントするか」の判定は、
 * Web の集計 API・型ヘルパー・iOS・CF の各所で同じでなければならない。
 * 以前は member-stats API がインライン実装で `type === 'visit'` のみを見ており、
 * 旧データ(countAsGroup 未設定)の `outside`(外出) を取りこぼして、
 * 日次サマリ通知や types の正準ルール（visit || outside）と食い違っていた。
 * その乖離を防ぐため純関数に一本化する。
 */

/**
 * 組数カウント対象か。
 * - countAsGroup が明示指定(true/false)ならそれを尊重
 * - 未指定(null/undefined = 旧データ)は後方互換で visit / outside のみ対象
 * iOS の ContactLog.isCountedAsGroup と同等。
 */
export function countsAsGroup(
  type: string | null | undefined,
  countAsGroup: boolean | null | undefined,
): boolean {
  if (countAsGroup === true) return true;
  if (countAsGroup === false) return false;
  return type === 'visit' || type === 'outside';
}
