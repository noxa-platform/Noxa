import type { Metadata } from 'next';
import { CommunityAdminGate } from '@/components/community/CommunityAdminGate';

export const metadata: Metadata = {
  title: 'NOXA Channel 管理',
  robots: { index: false, follow: false },
};

export default function CommunityAdminPage() {
  return <CommunityAdminGate />;
}
