'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { CustomersClient } from '@/components/modules/customers/CustomersClient';

export default function CustomersPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><CustomersClient user={user} /></AccountShell>}</AuthGuard>;
}
