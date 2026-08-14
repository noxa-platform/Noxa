/**
 * `firebase-functions/logger` の最小スタブ（Day119）。
 * CF は `import * as logger from 'firebase-functions/logger'` の形でも使うため、
 * `firebase-functions` 本体とは別に名前空間 import 用のスタブを用意する。
 * console へ委譲するので、テストは `vi.spyOn(console, ...)` で記録を確認できる。
 */
export const error = (...args: unknown[]) => console.error(...args);
export const warn = (...args: unknown[]) => console.warn(...args);
export const info = (...args: unknown[]) => console.info(...args);
export const debug = (...args: unknown[]) => console.debug(...args);
