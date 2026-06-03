'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { NotificationsClient } from '@/components/modules/notifications/NotificationsClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><NotificationsClient user={user}/></AccountShell>}</AuthGuard>; }
