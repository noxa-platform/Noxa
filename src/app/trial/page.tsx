'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { TrialClient } from '@/components/modules/trial/TrialClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><TrialClient user={user}/></AccountShell>}</AuthGuard>; }
