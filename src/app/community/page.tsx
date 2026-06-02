import type { Metadata } from 'next';
import { CommunityGate } from '@/components/community/CommunityGate';

export const metadata: Metadata = {
  title: 'Community — Noxa',
  description:
    '招待制クローズド × 完全匿名の掲示板。夜職に携わる方同士が情報共有・相互サポートできる、Noxa 内のコミュニティ機能。',
};

export default function CommunityPage() {
  return <CommunityGate />;
}
