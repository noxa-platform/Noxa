import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NOXA — 夜の街のためのプラットフォーム',
  description: 'ナイトワーカー・夜の街オーナー・夜遊びユーザーのための統合プラットフォーム NOXA。アカウント 1 つで yorulog / nomishugy / NOXA コミュニティを利用。',
  metadataBase: new URL('https://noxa.vercel.app'),
  openGraph: {
    title: 'NOXA',
    description: '夜の街のためのプラットフォーム',
    type: 'website',
    locale: 'ja_JP',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
