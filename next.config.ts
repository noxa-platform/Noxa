import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 開発時の Strict クエリで Firebase 重複初期化を避けるため、experimental は最小限
};

export default nextConfig;
