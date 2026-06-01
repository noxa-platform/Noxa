'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { SeatingClient } from '@/components/modules/seating/SeatingClient';

export default function SeatingOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><SeatingClient user={user} /></AccountShell>}</AuthGuard>;
}
