/**
 * `firebase-functions` の最小スタブ（Day118）。
 *
 * Cloud Functions（`functions/`）は独自の package.json を持ち、依存はそちらにしか無い。
 * ルートの vitest から CF の**中身**（無音の失敗の有無）を検証できるよう、
 * vitest.config.ts の alias でこのスタブへ差し替える。
 * logger は console へ委譲するので、テストは `vi.spyOn(console, 'error')` で記録を確認できる。
 */
export const logger = {
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  info: (...args: unknown[]) => console.info(...args),
  debug: (...args: unknown[]) => console.debug(...args),
};
