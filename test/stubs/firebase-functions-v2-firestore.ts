/**
 * `firebase-functions/v2/firestore` の最小スタブ（Day118）。
 * トリガー定義をそのままハンドラ関数として返すので、テストから直接呼べる。
 */
type Handler = (event: unknown) => unknown;
export function onDocumentWritten(_opts: unknown, handler?: Handler): Handler {
  return (typeof _opts === 'function' ? _opts : handler) as Handler;
}
export function onDocumentCreated(_opts: unknown, handler?: Handler): Handler {
  return (typeof _opts === 'function' ? _opts : handler) as Handler;
}
export function onDocumentDeleted(_opts: unknown, handler?: Handler): Handler {
  return (typeof _opts === 'function' ? _opts : handler) as Handler;
}
