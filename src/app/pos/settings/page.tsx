'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { PosConfigClient } from '@/components/modules/pos-config/PosConfigClient';

export default function PosSettingsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><PosConfigClient user={user} /></AccountShell>}</AuthGuard>;
}
