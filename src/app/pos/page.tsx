'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { PosClient } from '@/components/modules/pos/PosClient';

export default function PosOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><PosClient /></AccountShell>}</AuthGuard>;
}
