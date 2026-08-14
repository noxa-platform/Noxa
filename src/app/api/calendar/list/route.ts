import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '../lib';
import { verifyRequest } from '../../lib/firebase-admin';

// カレンダー一覧を取得
export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyRequest(request);
  } catch {
    // 空配列は「カレンダーが1つも無い」と同じ形。Day116 でエラー経路だけ直したが、
    // 認証・未連携の 2 経路が空配列のまま残っていた（Day116-PM）
    return NextResponse.json({ error: '未認証' }, { status: 401 });
  }

  const token = await getValidToken(uid);
  if (!token) return NextResponse.json({ error: 'Google カレンダーと連携されていません' }, { status: 401 });

  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // 空配列を返すと「カレンダーが1つも無い」と区別できない（Day116）
      console.error('[api/calendar/list] calendarList failed:', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ error: 'カレンダー一覧を取得できませんでした' }, { status: res.status });
    }

    const data = await res.json();
    const calendars = (data.items || []).map((item: { id: string; summary: string }) => ({
      id: item.id,
      summary: item.summary,
    }));

    return NextResponse.json(calendars);
  } catch (e) {
    // 旧実装は理由をログにも残さず空配列を返しており、500 なのに「予定なし」に見えた
    console.error('[api/calendar/list] error:', e);
    return NextResponse.json({ error: 'カレンダー一覧を取得できませんでした' }, { status: 500 });
  }
}
