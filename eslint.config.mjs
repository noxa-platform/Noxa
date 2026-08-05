// Next.js 16 / ESLint 9 flat config。
// eslint-config-next の flat config 配列（typescript ルール込み）を直接読み込む。
// 旧 FlatCompat.extends 方式は next/typescript 展開時に循環構造で異常終了していたため撤去。
import coreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...coreWebVitals,
  {
    // `_design-source/**` はビルド対象外の設計資料（Claude Design が出力した JSX モック）。
    // アプリからは import されないため lint 対象に含めない（Day101。含めると
    // react-hooks/static-components で 13 error になり、リポ全体の lint ゲートが赤になる）。
    ignores: [
      '.next/**', 'node_modules/**', 'out/**', 'dist/**', 'next-env.d.ts',
      '_design-source/**',
    ],
  },
];
