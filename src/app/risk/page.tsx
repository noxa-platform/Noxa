'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { RiskClient } from '@/components/modules/risk/RiskClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><RiskClient/></AccountShell>}</AuthGuard>; }
