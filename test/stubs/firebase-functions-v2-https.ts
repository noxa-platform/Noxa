/**
 * `firebase-functions/v2/https` の最小スタブ（Day121）。
 *
 * `onRequest` は登録の薄い皮なので、ハンドラをそのまま返す。
 * これで CF の HTTP 関数（merge / noxa-auth 等）を含むモジュールを
 * ルートの vitest から import して、中の純ロジックを検証できる。
 */
export function onRequest(
  _opts: unknown,
  handler: (req: unknown, res: unknown) => unknown,
): (req: unknown, res: unknown) => unknown {
  return handler;
}

export class HttpsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
