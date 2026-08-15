/**
 * 「書き込みが実際に適用されたか」を呼び出し側へ返すための共通判定（純関数・Day124）。
 *
 * トランザクションの中で対象 doc を読み直す実装は、対象が消えていると
 * `if (!snap.exists()) return;` で**何も書かずに正常終了**する。Day117 の `run()` は
 * 例外が出なければ成功とみなすため、**画面には成功として出る**（読み取り側で今週ずっと
 * 直してきた「偽の成功」の、書き込み側の形）。
 *
 * 実害（Day124 で確認）:
 *   - 会計: 別端末が先に会計した伝票をもう一度会計すると、売上は 1 件も増えないのに
 *     `ok=true` が返って UI は伝票を閉じる。両方の端末が「会計した」と思い、
 *     金額が違えば売上が食い違ったまま誰も気づかない。
 *   - 伝票操作: 会計・破棄済みの伝票への注文追加が黙って消える（ボトル 1 本＝売上が落ちる）。
 *   - 卓操作: 卓 doc が消えていると配置・延長・退店が無反応のまま成功に見える。
 *
 * 判定の要点は **「意図した変更なし（unchanged）」と「対象が消えていた（missing）」を
 * 必ず区別する**こと。前者は成功、後者は失敗として報告する。
 * （例: 回し替えはキャストが 1 人以下なら変更なし＝正常。卓が消えていたのは異常。）
 */

/** 消えていた対象の種別。文言を現場の言葉に寄せるため個別に持つ */
export type MissingTarget = 'table' | 'slip' | 'queue' | 'unpaid';

/** 書き込みの結末 */
export type WriteOutcome =
  | { kind: 'applied' }
  | { kind: 'unchanged' }
  | { kind: 'missing'; target: MissingTarget };

export const APPLIED: WriteOutcome = { kind: 'applied' };
export const UNCHANGED: WriteOutcome = { kind: 'unchanged' };
export function missing(target: MissingTarget): WriteOutcome {
  return { kind: 'missing', target };
}

/** 対象種別ごとの「何が起きたか」＋「次に何をすればよいか」 */
const MISSING_TEXT: Record<MissingTarget, { what: string; hint: string }> = {
  table: {
    what: '卓が見つかりません',
    hint: '他の端末で削除・初期化された可能性があります。画面を再読み込みしてください。',
  },
  slip: {
    what: '伝票が見つかりません',
    hint: '他の端末で会計・破棄された可能性があります。二重に記録しないよう、売上画面で記録済みかを確認してください。',
  },
  queue: {
    what: '待ち組が見つかりません',
    hint: '他の端末で先に案内された可能性があります。待ち一覧を確認してください。',
  },
  unpaid: {
    what: '売掛の記録が見つかりません',
    hint: '他の端末で削除・回収済にされた可能性があります。一覧を再読み込みして残高を確認してください。',
  },
};

/**
 * 対象が消えていたことの説明文を組み立てる。
 * @param target 消えていた対象
 * @param opts.name 卓名・伝票名など（分かるときは必ず入れる。現場は名前でしか特定できない）
 * @param opts.hint 既定の案内を上書きする文言（会計のように次の行動が変わる場合に使う）
 */
export function describeMissingWrite(
  target: MissingTarget,
  opts?: { name?: string | null; hint?: string },
): string {
  const t = MISSING_TEXT[target];
  const name = opts?.name?.trim();
  const head = name ? `${t.what.replace('が見つかりません', '')}「${name}」が見つかりません` : t.what;
  return `${head}。${opts?.hint ?? t.hint}`;
}

/**
 * 「適用された」以外を失敗として投げる（`unchanged` は成功のまま通す）。
 *
 * throw した Error は code を持たないため `describeFirestoreError` が message を主文に使う
 * ＝そのまま Day117 の opError バナーに現場向けの文言として出る。
 */
export function assertWriteApplied(
  outcome: WriteOutcome,
  opts?: { name?: string | null; hint?: string },
): void {
  if (outcome.kind === 'missing') throw new Error(describeMissingWrite(outcome.target, opts));
}
