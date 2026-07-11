import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 既定 test = 純関数の単体テストのみ（エミュレータ不要）。
// rules テスト（test/rules）は Firestore エミュレータが要るため除外し、
// `npm run test:rules`（vitest.rules.config.ts + emulators:exec）で別途実行する。
export default defineConfig({
  resolve: {
    // tsconfig の paths（@/ → src/）を vitest でも解決する
    // （src 内モジュールが '@/lib/...' import を含む場合に CI で ERR_MODULE_NOT_FOUND になるため）
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'test/rules/**'],
    testTimeout: 15000,
  },
});
