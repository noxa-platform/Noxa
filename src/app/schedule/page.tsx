'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { ScheduleClient } from '@/components/modules/schedule/ScheduleClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><ScheduleClient user={user}/></AccountShell>}</AuthGuard>; }
