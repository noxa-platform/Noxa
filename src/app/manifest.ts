import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noxa',
    short_name: 'Noxa',
    description: '夜の街のための統合プラットフォーム',
    start_url: '/',
    display: 'standalone',
    background_color: '#07050D',
    theme_color: '#07050D',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    lang: 'ja',
    dir: 'ltr',
    categories: ['lifestyle', 'social', 'business'],
  };
}
