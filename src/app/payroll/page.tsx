'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { PayrollClient } from '@/components/modules/payroll/PayrollClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><PayrollClient user={user}/></AccountShell>}</AuthGuard>; }
