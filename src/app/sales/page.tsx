'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { SalesClient } from '@/components/modules/sales/SalesClient';

export default function SalesOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><SalesClient user={user} /></AccountShell>}</AuthGuard>;
}
