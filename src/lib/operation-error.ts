'use client';

import { useCallback, useState } from 'react';
import { describeFirestoreError } from '@/lib/firestore-error';

/**
 * 「操作（書き込み）の失敗」をストア単位で1本にまとめて画面へ渡す仕組み（Day117）。
 *
 * 席回し・POS・初回案内の画面は、卓や伝票の操作を JSX から**投げっぱなし**で呼んでいた:
 *
 *   onClick={() => store.checkTable(t.id)}
 *
 * await も catch も無いので、権限エラー・オフライン・トランザクション競合で失敗しても
 * **画面には何も出ない**（押しても無反応にしか見えない）。接客中に一番困る形で、
 * しかも今週育てた無音ガードは「名前の付いた関数」か「await された書き込み」しか
 * 見ていないため、この形だけが 8 判定すべてをすり抜けていた。
 *
 * ここでは各ストアの書き込みメソッドを `guard()` で包み、
 *   - 失敗したら理由を `opError` に載せる（画面が1箇所で表示できる）
 *   - **成功したかどうかを boolean で返す**（`if (await store.addCast(...))` と書ける）
 * という契約に統一する。呼び出し側が結果を無視しても、失敗は必ず画面に出る。
 */
export type OperationErrorApi = {
  /** 直近の操作失敗（画面の共通バナーに出す）。成功すると消える */
  opError: string | null;
  /** バナーの「閉じる」用 */
  clearOpError: () => void;
  /**
   * 書き込みを実行する。成功=true / 失敗=false（理由は opError）。
   *
   * 引数は**関数そのものではなく呼び出しを包んだ thunk** にしている。
   * 生の実装を render 中に受け渡すと React Compiler の `react-hooks/refs`
   * （ref を読む関数を render で渡すな）に触れるため、実行時に渡す形にした。
   * @param label 文言に混ぜる操作名（例: '会計'）
   */
  run: (label: string, op: () => Promise<unknown>) => Promise<boolean>;
};

/**
 * `run` の本体（React に依存しない純ロジック。テストはここに当てる）。
 *
 * 契約:
 *   - 成功したら true を返し、直前の失敗表示を消す
 *   - 失敗したら false を返し、`describeFirestoreError` の文言を通知する
 *   - **呼び出し側へは throw しない**（JSX から投げっぱなしで呼ばれるため、
 *     未処理の rejection にせず、必ず画面へ出す経路に乗せる）
 */
export async function runOperation(
  label: string,
  op: () => Promise<unknown>,
  notify: (message: string | null) => void,
): Promise<boolean> {
  try {
    await op();
    notify(null);
    return true;
  } catch (e) {
    notify(describeFirestoreError(e, label));
    return false;
  }
}

export function useOperationError(): OperationErrorApi {
  const [opError, setOpError] = useState<string | null>(null);
  const clearOpError = useCallback(() => setOpError(null), []);

  const run = useCallback(
    (label: string, op: () => Promise<unknown>) => runOperation(label, op, setOpError),
    [],
  );

  return { opError, clearOpError, run };
}
