import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '../lib';
import { verifyRequest } from '../../lib/firebase-admin';

// イベントを取得。
// クエリ:
//   - calendarId (必須、複数可): 対象カレンダー
//   - timeMin / timeMax (任意 ISO): 取得範囲。未指定なら今日 1 日分
//
// H-3 で月グリッド UI を追加するため、`?timeMin&timeMax` で任意期間取得に対応。
export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyRequest(request);
  } catch {
    return NextResponse.json([], { status: 401 });
  }
  const calendarIds = request.nextUrl.searchParams.getAll('calendarId');
  if (calendarIds.length === 0) return NextResponse.json([]);

  const token = await getValidToken(uid);
  if (!token) return NextResponse.json([], { status: 401 });

  const explicitMin = request.nextUrl.searchParams.get('timeMin');
  const explicitMax = request.nextUrl.searchParams.get('timeMax');
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const timeMin = explicitMin || startOfDay;
  const timeMax = explicitMax || endOfDay;

  try {
    const allEvents = [];

    for (const calendarId of calendarIds) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
      });

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) continue;

      const data = await res.json();
      for (const item of data.items || []) {
        allEvents.push({
          id: item.id,
          summary: item.summary || '(タイトルなし)',
          start: item.start?.dateTime || item.start?.date || '',
          end: item.end?.dateTime || item.end?.date || '',
          customerId: item.extendedProperties?.private?.app_customer_id || null,
          workspaceId: item.extendedProperties?.private?.app_workspace_id || null,
        });
      }
    }

    return NextResponse.json(allEvents);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

// 予定を追加
export async function POST(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyRequest(request);
  } catch {
    return NextResponse.json({ error: '未認証' }, { status: 401 });
  }
  const body = await request.json();
  const { calendarId, summary, start, end, customerId, workspaceId } = body;

  if (!calendarId || !summary || !start) {
    return NextResponse.json({ error: '必須パラメータが不足' }, { status: 400 });
  }

  const token = await getValidToken(uid);
  if (!token) return NextResponse.json({ error: '未認証' }, { status: 401 });

  try {
    const event: Record<string, unknown> = {
      summary,
      start: { dateTime: start, timeZone: 'Asia/Tokyo' },
      end: { dateTime: end || start, timeZone: 'Asia/Tokyo' },
    };

    // 顧客・ワークスペースIDをextendedPropertiesに格納
    if (customerId || workspaceId) {
      event.extendedProperties = {
        private: {
          ...(customerId && { app_customer_id: customerId }),
          ...(workspaceId && { app_workspace_id: workspaceId }),
        },
      };
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('イベント作成失敗:', err);
      return NextResponse.json({ error: 'イベント作成失敗' }, { status: res.status });
    }

    const created = await res.json();
    return NextResponse.json({ id: created.id });
  } catch {
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
