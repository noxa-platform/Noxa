'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { CalcClient } from '@/components/modules/personal-calc/CalcClient';

export default function CalcPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><CalcClient user={user} /></AccountShell>}</AuthGuard>;
}
