import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { SUPPORT_INFO } from '@/lib/legal/documents';

// App Store Connect のサポート URL（必須項目）が指す公開ページ。
// /privacy /terms と同じく認証なしの静的ページにする（審査は未ログインで開くため）。
export const metadata: Metadata = {
  title: 'サポート — Noxa',
  description: 'Noxa および Noxa 配下の各サービス（YoruLog、のみシュギ 等）のお問い合わせ窓口・よくある質問。',
};

export default function SupportPage() {
  return <LegalDocumentView doc={SUPPORT_INFO} />;
}
