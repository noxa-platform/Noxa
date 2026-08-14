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
      'firebase-functions/v2': path.resolve(__dirname, 'test/stubs/firebase-functions-v2.ts'),
      'firebase-functions': path.resolve(__dirname, 'test/stubs/firebase-functions.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'test/rules/**'],
    testTimeout: 15000,
  },
});
