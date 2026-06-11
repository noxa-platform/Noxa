'use client';

import { useEffect } from 'react';

/** PWA Service Worker 登録（本番のみ）。オフライン時のアプリ起動＋キャッシュ用。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 失敗は無視 */ });
  }, []);
  return null;
}

export default ServiceWorkerRegister;
