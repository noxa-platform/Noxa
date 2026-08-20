import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { PRIVACY_POLICY } from '@/lib/legal/documents';

// App Store / Google Play の審査で参照される公開 URL。
// yorulog-ios の提出はこの URL が 404 であることが唯一のブロッカーだった。
export const metadata: Metadata = {
  title: 'プライバシーポリシー — Noxa',
  description: 'Noxa アカウントおよび Noxa 配下の各サービス（YoruLog、のみシュギ 等）に適用されるプライバシーポリシー。',
};

export default function PrivacyPage() {
  return <LegalDocumentView doc={PRIVACY_POLICY} />;
}
