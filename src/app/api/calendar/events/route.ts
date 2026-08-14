import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '../lib';
import { verifyRequest } from '../../lib/firebase-admin';
import { jstDayWindow } from '@/lib/datetime';

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
    // 空配列は「予定なし」と同じ形。認証/未連携は理由の分かる形で返す（Day116-PM。POST 側は元からこの形）
    return NextResponse.json({ error: '未認証' }, { status: 401 });
  }
  const calendarIds = request.nextUrl.searchParams.getAll('calendarId');
  if (calendarIds.length === 0) return NextResponse.json([]);

  const token = await getValidToken(uid);
  if (!token) return NextResponse.json({ error: 'Google カレンダーと連携されていません（連携済みの場合は連携が切れています。再連携してください）' }, { status: 401 });

  const explicitMin = request.nextUrl.searchParams.get('timeMin');
  const explicitMax = request.nextUrl.searchParams.get('timeMax');
  // 既定は「今日 1 日分」。サーバは UTC 動作(Vercel)のため、JST 暦日で窓を組む
  // （旧実装は new Date(y,m,d)=UTC 暦日で JST 早朝帯に前日/翌朝へズレていた）。
  const { startIso, endIso } = jstDayWindow();
  const timeMin = explicitMin || startIso;
  const timeMax = explicitMax || endIso;

  try {
    const allEvents = [];
    // 取得できなかったカレンダー。旧実装は `continue` で黙って飛ばしており、
    // 権限剥奪・カレンダー削除・レート制限のいずれでも「その日は予定なし」と同じ応答になっていた
    // （＝出勤や同伴の予定を見落とす）。全滅は 502、部分失敗はヘッダで伝える（Day111）。
    const failed: string[] = [];

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

      if (!res.ok) {
        // 理由を残さないと「権限剥奪なのか一時障害なのか」を運用者が切り分けられない（Day116-PM）
        console.error('[api/calendar/events] events fetch failed:', calendarId, res.status, await res.text().catch(() => ''));
        failed.push(calendarId);
        continue;
      }

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

    if (failed.length === calendarIds.length) {
      // 1件も読めていない。空配列＋200 は「予定が無い」と区別できないので成功を装わない
      console.error('[api/calendar/events] 全カレンダーの取得に失敗（502）:', failed.join(','));
      return NextResponse.json(
        { error: 'カレンダーを取得できませんでした', failedCalendarIds: failed },
        { status: 502, headers: { 'X-Calendar-Failed': failed.join(',') } },
      );
    }
    // 部分失敗は取得できた分を返しつつ、欠けている事実をヘッダで伝える（既存の配列レスポンス互換）
    return NextResponse.json(allEvents, failed.length ? { headers: { 'X-Calendar-Failed': failed.join(',') } } : undefined);
  } catch (e) {
    console.error('[api/calendar/events] GET error:', e);
    return NextResponse.json({ error: 'カレンダーを取得できませんでした' }, { status: 500 });
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
  const body = await request.json().catch(() => ({}));
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
  } catch (e) {
    console.error('[api/calendar/events] POST error:', e);
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
