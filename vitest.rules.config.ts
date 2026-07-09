import { defineConfig } from 'vitest/config';

// Firestore ルールテスト専用（要 Firestore エミュレータ）。
// `npm run test:rules` が `firebase emulators:exec --only firestore` 配下でこの設定を使う。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/rules/**/*.test.ts'],
    testTimeout: 20000,
  },
});
