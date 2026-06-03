'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { BusinessCardClient } from '@/components/modules/business-card/BusinessCardClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><BusinessCardClient user={user}/></AccountShell>}</AuthGuard>; }
