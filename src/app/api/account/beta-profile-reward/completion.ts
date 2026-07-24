// プロファイル「全項目埋め」判定の単一ソース。
//
// beta-profile-reward の GET（診断表示）と POST（報酬受領ガード）が同じ基準で判定するための
// 純ヘルパー。以前は両ハンドラに同じ判定式をコピペしており、片方だけ直すと GET/POST が
// 食い違う（診断は「埋まった」表示なのに受領で 400 になる等）ドリフト源だった（Day69 で共通化）。

/** 報酬対象の必須プロファイル項目（SelfBaseStyle の 6 項目）。 */
export const REQUIRED_PROFILE_FIELDS = [
  'stageName',
  'staffRole',
  'gender',
  'firstPerson',
  'defaultTone',
  'emojiLevel',
] as const;

export type ProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

/**
 * 1 項目が「埋まっている」か。
 * - undefined / null は未入力
 * - 文字列は trim 後に 1 文字以上あれば埋まり（空文字・空白のみは未）
 * - 非文字列（数値 0 / boolean 等）は値が存在する時点で埋まり扱い（emojiLevel=0 を弾かない）
 */
export function isProfileFieldFilled(v: unknown): boolean {
  return v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length > 0);
}

export interface ProfileCompletion {
  filled: Record<string, boolean>;
  filledCount: number;
  requiredCount: number;
  allFilled: boolean;
  /** 未入力の先頭項目（REQUIRED_PROFILE_FIELDS 順）。全部埋まっていれば null */
  firstMissing: ProfileField | null;
}

/** SelfBaseStyle ドキュメントの埋まり具合をまとめて診断する。 */
export function evaluateProfileCompletion(self: Record<string, unknown>): ProfileCompletion {
  const filled: Record<string, boolean> = {};
  let filledCount = 0;
  let firstMissing: ProfileField | null = null;
  for (const k of REQUIRED_PROFILE_FIELDS) {
    const ok = isProfileFieldFilled(self[k]);
    filled[k] = ok;
    if (ok) filledCount++;
    else if (firstMissing === null) firstMissing = k;
  }
  return {
    filled,
    filledCount,
    requiredCount: REQUIRED_PROFILE_FIELDS.length,
    allFilled: filledCount === REQUIRED_PROFILE_FIELDS.length,
    firstMissing,
  };
}
