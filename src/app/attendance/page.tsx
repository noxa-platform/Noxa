'use client';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { AttendanceClient } from '@/components/modules/attendance/AttendanceClient';

export default function AttendanceOsPage() {
  return <AuthGuard>{(user) => <AccountShell user={user}><AttendanceClient /></AccountShell>}</AuthGuard>;
}
