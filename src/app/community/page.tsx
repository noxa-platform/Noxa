import type { Metadata } from 'next';
import { CommunityGate } from '@/components/community/CommunityGate';

export const metadata: Metadata = {
  title: 'NOXA Channel',
  description:
    'NOXA Channel — 招待制クローズド × 完全匿名の掲示板。夜職に携わる方同士が情報共有・相互サポートできる、Noxa 内のコミュニティ。',
};

export default function CommunityPage() {
  return <CommunityGate />;
}
