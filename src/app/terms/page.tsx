import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { TERMS_OF_SERVICE } from '@/lib/legal/documents';

export const metadata: Metadata = {
  title: '利用規約 — Noxa',
  description: 'Noxa アカウントおよび Noxa 配下の各サービス（YoruLog、のみシュギ 等）に適用される利用規約。',
};

export default function TermsPage() {
  return <LegalDocumentView doc={TERMS_OF_SERVICE} />;
}
