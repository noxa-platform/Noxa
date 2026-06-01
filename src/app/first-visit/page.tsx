'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { FirstVisitClient } from '@/components/modules/first-visit/FirstVisitClient';

export default function FirstVisitOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><FirstVisitClient /></AccountShell>}</AuthGuard>;
}
