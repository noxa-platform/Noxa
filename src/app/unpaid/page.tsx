'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { UnpaidClient } from '@/components/modules/unpaid/UnpaidClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><UnpaidClient/></AccountShell>}</AuthGuard>; }
