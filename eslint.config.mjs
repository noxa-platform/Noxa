// Next.js 16 / ESLint 9 flat config。
// eslint-config-next の flat config 配列（typescript ルール込み）を直接読み込む。
// 旧 FlatCompat.extends 方式は next/typescript 展開時に循環構造で異常終了していたため撤去。
import coreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...coreWebVitals,
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'dist/**', 'next-env.d.ts'],
  },
];
