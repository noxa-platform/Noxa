'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { PayrollClient } from '@/components/modules/payroll/PayrollClient';

export default function PayrollOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><PayrollClient /></AccountShell>}</AuthGuard>;
}
