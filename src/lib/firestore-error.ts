/**
 * Firestore / Firebase の失敗を「利用者が次に何をすればいいか分かる日本語」に直す単一ヘルパー。
 *
 * 各モジュールは失敗時に `e.code`（`permission-denied` 等）や `e.message`
 * （`Missing or insufficient permissions.`）を**そのまま**画面や alert に出しており、
 * 夜職の現場スタッフには何が起きたか伝わらなかった。文言をここに集約し、
 * 「何が起きたか＋どうすればよいか」を必ず含める。
 *
 * 原因コードは調査のため末尾に括弧書きで残す（サポート時に必要なため落とさない）。
 */

/** 主要な Firestore エラーコード → 現場向けの説明。ここに無いコードは汎用文言になる。 */
const MESSAGES: Record<string, string> = {
  'permission-denied': '権限がありません。店舗の管理者に操作権限をご確認ください。',
  'unauthenticated': 'ログインの有効期限が切れています。一度ログアウトして再度ログインしてください。',
  'unavailable': '通信できませんでした。電波状況を確認してもう一度お試しください。',
  'deadline-exceeded': '通信がタイムアウトしました。もう一度お試しください。',
  'not-found': '対象のデータが見つかりませんでした。画面を再読み込みしてください。',
  'already-exists': 'すでに同じデータが登録されています。',
  'failed-precondition': 'いまの状態では実行できません。画面を再読み込みしてからお試しください。',
  'aborted': '同時に別の操作が行われました。もう一度お試しください。',
  'resource-exhausted': '利用量の上限に達しました。しばらくおいてからお試しください。',
  'cancelled': '操作が中断されました。もう一度お試しください。',
};

/** 例外から Firestore のエラーコードを取り出す（無ければ null） */
export function errorCode(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string' || !code) return null;
  // Firebase の code は 'permission-denied' か、モジュール接頭辞つき 'auth/network-request-failed'
  return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
}

/**
 * 失敗の説明文を組み立てる。
 * @param e     捕まえた例外
 * @param what  何をしようとしていたか（例: '売上の記録'）。付けると先頭に「〜に失敗しました。」が付く
 */
export function describeFirestoreError(e: unknown, what?: string): string {
  const code = errorCode(e);
  const head = what ? `${what}に失敗しました。` : '';
  if (code) {
    const known = MESSAGES[code];
    // 未知コードは汎用文言＋コード（原文コードを消すとサポートで追えなくなる）
    return known ? `${head}${known}（${code}）` : `${head || '操作に失敗しました。'}時間をおいて再度お試しください。（${code}）`;
  }
  // code を持たない Error は自前のガード（例「使用中の卓です」）が投げた説明文＝それ自体が案内。
  // 汎用文言で包むと本当の理由が括弧の中に埋もれるので、message を主文として使う。
  if (e instanceof Error && e.message) return `${head}${e.message}`;
  return `${head || '操作に失敗しました。'}時間をおいて再度お試しください。`;
}

/** 権限不足かどうか（「権限が無いだけ」を通常の失敗と区別して案内したい箇所で使う） */
export function isPermissionDenied(e: unknown): boolean {
  return errorCode(e) === 'permission-denied';
}
