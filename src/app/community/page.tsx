import type { Metadata } from 'next';
import { CommunityClient } from '@/components/community/CommunityClient';

export const metadata: Metadata = {
  title: 'Community — Noxa',
  description:
    '紹介制クローズド SNS。夜職に携わる方同士が情報共有・相互サポートできる、Noxa 内のコミュニティ機能。',
};

export default function CommunityPage() {
  return <CommunityClient />;
}
