import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#07050D' },
    { media: '(prefers-color-scheme: dark)',  color: '#07050D' },
  ],
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://noxa.egshugy.com'),
  title: {
    default: 'Noxa — 夜の街のための統合プラットフォーム',
    template: '%s · Noxa',
  },
  description:
    'ナイトワーカー・夜の街オーナー・夜遊びユーザーのための統合プラットフォーム Noxa。アカウント 1 つで yorulog（夜職売上 CRM）、nomishugy（大阪バーポータル）、Noxa コミュニティを利用できます。',
  applicationName: 'Noxa',
  authors: [{ name: 'egshugy' }],
  generator: 'Next.js',
  keywords: [
    'Noxa',
    'ノクサ',
    'よるしゅぎ',
    'えぐしゅぎ',
    'ナイトワーカー',
    '夜職',
    '夜の街',
    'ホスト',
    'キャバ',
    'バー',
    'CRM',
    '統合プラットフォーム',
  ],
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    siteName: 'Noxa',
    title: 'Noxa — Nightfall, refined.',
    description: '夜の街のための統合プラットフォーム。アカウント 1 つで、すべてのサービスに。',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Noxa',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Noxa — Nightfall, refined.',
    description: '夜の街のための統合プラットフォーム。',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">
        {/* a11y: skip to main content (見える化は globals.css の .noxa-skip-link:focus) */}
        <a href="#main" className="noxa-skip-link">
          メインコンテンツへスキップ
        </a>
        <main id="main">{children}</main>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
