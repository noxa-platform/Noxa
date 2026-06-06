'use client';
import { use } from 'react';
import { PublicProfile } from '@/components/profile/PublicProfile';
export default function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  return <PublicProfile handle={handle} expectType="shop" />;
}
