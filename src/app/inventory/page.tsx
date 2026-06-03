'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { InventoryClient } from '@/components/modules/inventory/InventoryClient';
export default function Page(){ return <AuthGuard>{(user)=> <AccountShell user={user}><InventoryClient user={user}/></AccountShell>}</AuthGuard>; }
