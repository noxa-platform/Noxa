'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { ReservationClient } from '@/components/modules/reservation/ReservationClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><ReservationClient/></AccountShell>}</AuthGuard>; }
