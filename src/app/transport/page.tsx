'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { TransportClient } from '@/components/modules/transport/TransportClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><TransportClient user={user}/></AccountShell>}</AuthGuard>; }
