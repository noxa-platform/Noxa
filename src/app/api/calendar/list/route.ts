import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '../lib';
import { verifyRequest } from '../../lib/firebase-admin';

// カレンダー一覧を取得
export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyRequest(request);
  } catch {
    return NextResponse.json([], { status: 401 });
  }

  const token = await getValidToken(uid);
  if (!token) return NextResponse.json([], { status: 401 });

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return NextResponse.json([], { status: res.status });

    const data = await res.json();
    const calendars = (data.items || []).map((item: { id: string; summary: string }) => ({
      id: item.id,
      summary: item.summary,
    }));

    return NextResponse.json(calendars);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
