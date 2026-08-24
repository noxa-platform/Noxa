import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 既定 test = 純関数の単体テストのみ（エミュレータ不要）。
// rules テスト（test/rules）は Firestore エミュレータが要るため除外し、
// `npm run test:rules`（vitest.rules.config.ts + emulators:exec）で別途実行する。
export default defineConfig({
  resolve: {
    // tsconfig の paths（@/ → src/）を vitest でも解決する
    // （src 内モジュールが '@/lib/...' import を含む場合に CI で ERR_MODULE_NOT_FOUND になるため）
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Cloud Functions（functions/）は依存を自分の package.json に持つため、ルートからは
      // firebase-functions を解決できない。CF の中身をルートの vitest で検証するための最小スタブ（Day118）
      'firebase-functions/v2/firestore': path.resolve(__dirname, 'test/stubs/firebase-functions-v2-firestore.ts'),
      'firebase-functions/logger': path.resolve(__dirname, 'test/stubs/firebase-functions-logger.ts'),
      'firebase-functions/v2/https': path.resolve(__dirname, 'test/stubs/firebase-functions-v2-https.ts'),
      'firebase-functions/v2': path.resolve(__dirname, 'test/stubs/firebase-functions-v2.ts'),
      'firebase-functions': path.resolve(__dirname, 'test/stubs/firebase-functions.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'test/rules/**'],
    testTimeout: 15000,
    // AI 緊急停止スイッチ（2026-08-25）は**既定が停止**（fail-closed）。
    // 単体テストは各ルートの本来の挙動を見るものなので、明示的に「動かす」側に固定する。
    // 停止そのものの挙動は test/lib/ai-kill-switch.test.ts が env を上書きして検証する。
    env: { AI_KILL_SWITCH: '0' },
  },
});
