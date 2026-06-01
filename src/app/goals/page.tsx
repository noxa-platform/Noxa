'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { GoalsClient } from '@/components/modules/goals/GoalsClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><GoalsClient/></AccountShell>}</AuthGuard>; }
