// 管理者専用: 直近 N 日の Push 配信統計を返す。
// Cloud Functions の `crm_push_stats/{YYYY-MM-DD}` を Admin SDK で読み取り、
// /dev/push-test ページから参照する。
//
// 認証: Firebase ID Token (Bearer) + 管理者 email チェック。

import { NextResponse } from 'next/server';
import {
  getAdminAuth,
  getAdminDb,
  verifyRequest,
  AuthError,
} from '@/app/api/lib/firebase-admin';
import { isAdmin } from '@/lib/admin';

interface PushStatsRow {
  date: string;
  sent: number;
  failed: number;
  invalidTokenDeleted: number;
  byFn?: Record<string, { sent?: number; failed?: number; invalidTokenDeleted?: number }>;
}

function jstDateKeys(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now.getTime() + 9 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dd}`);
  }
  return dates;
}

export async function GET(request: Request): Promise<Response> {
  let uid: string;
  try {
    uid = await verifyRequest(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  // email 取得（uid から auth で逆引き）
  let email: string | null | undefined;
  try {
    const userRecord = await getAdminAuth().getUser(uid);
    email = userRecord.email;
  } catch (err) {
    console.error('[push-stats] getUser failed', err);
    return NextResponse.json({ error: 'ユーザー情報を取得できません' }, { status: 500 });
  }

  if (!isAdmin(email)) {
    return NextResponse.json({ error: '管理者権限がありません' }, { status: 403 });
  }

  const url = new URL(request.url);
  const daysParam = url.searchParams.get('days');
  const days = Math.min(Math.max(parseInt(daysParam ?? '7', 10) || 7, 1), 30);

  const db = getAdminDb();
  const dates = jstDateKeys(days);
  const rows: PushStatsRow[] = [];
  for (const date of dates) {
    const snap = await db.doc(`crm_push_stats/${date}`).get();
    if (!snap.exists) {
      rows.push({ date, sent: 0, failed: 0, invalidTokenDeleted: 0 });
      continue;
    }
    const data = snap.data() ?? {};
    rows.push({
      date,
      sent: (data.sent as number | undefined) ?? 0,
      failed: (data.failed as number | undefined) ?? 0,
      invalidTokenDeleted: (data.invalidTokenDeleted as number | undefined) ?? 0,
      byFn: (data.byFn as PushStatsRow['byFn']) ?? undefined,
    });
  }
  return NextResponse.json({ rows });
}
