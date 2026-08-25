import { defineConfig } from 'vitest/config';

// 既定 test = 純関数の単体テストのみ（エミュレータ不要）。
// rules テスト（test/rules）は Firestore エミュレータが要るため除外し、
// `npm run test:rules`（vitest.rules.config.ts + emulators:exec）で別途実行する。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'test/rules/**'],
    testTimeout: 15000,
    // AI 緊急停止スイッチ（2026-08-25）は**既定が停止**（fail-closed）。
    // 単体テストは各ルートの本来の挙動を見るものなので、明示的に「動かす」側に固定する。
    env: { AI_KILL_SWITCH: '0' },
  },
});
