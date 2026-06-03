'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { FirstVisitSettingsClient } from '@/components/modules/first-visit/FirstVisitSettingsClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><FirstVisitSettingsClient user={user}/></AccountShell>}</AuthGuard>; }
