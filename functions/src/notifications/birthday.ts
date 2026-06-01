/**
 * 誕生日リマインダー: 毎日 9:00 JST。
 * 当日 または 7 日後が誕生日の顧客がいたら通知する。
 */
import * as logger from 'firebase-functions/logger';
import { listUidsWithPrefEnabled } from '../lib/prefs';
import { listOwnedWorkspaces, listCustomers } from '../lib/workspaces';
import { sendToUser } from '../lib/push';
import { extractMonthDay, jstMonthDayDaysAhead } from '../lib/datetime';
import type { CustomerLite } from '../types';

const FN_NAME = 'birthday';

interface Hit {
  customer: CustomerLite;
  daysAhead: 0 | 7;
}

/** 配信結果サマリー（admin trigger / 統計表示用） */
export interface RunResult {
  targetCount: number;   // 対象 uid 数
  notifyCount: number;   // 通知対象（hits > 0）の uid 数
  sentCount: number;     // 送信成功数
  failedCount: number;   // 送信失敗数
  errorCount: number;    // ループ内例外数（uid 単位）
}

export async function runBirthdayReminder(): Promise<RunResult> {
  const uids = await listUidsWithPrefEnabled('birthday');
  logger.info('[birthday] start', { targetCount: uids.length });

  const todayMd = jstMonthDayDaysAhead(0);
  const sevenMd = jstMonthDayDaysAhead(7);

  const result: RunResult = {
    targetCount: uids.length,
    notifyCount: 0,
    sentCount: 0,
    failedCount: 0,
    errorCount: 0,
  };

  for (const uid of uids) {
    try {
      const workspaces = await listOwnedWorkspaces(uid);
      const hits: Hit[] = [];
      for (const ws of workspaces) {
        const customers = await listCustomers(ws.id);
        for (const c of customers) {
          const md = extractMonthDay(c.birthday);
          if (!md) continue;
          if (md === todayMd) hits.push({ customer: c, daysAhead: 0 });
          else if (md === sevenMd) hits.push({ customer: c, daysAhead: 7 });
        }
      }
      if (hits.length === 0) continue;
      result.notifyCount += 1;
      const outcome = await notify(uid, hits);
      if (outcome === 'sent') result.sentCount += 1;
      else if (outcome === 'failed') result.failedCount += 1;
    } catch (err) {
      result.errorCount += 1;
      logger.error('[birthday] uid failed', {
        fnName: FN_NAME,
        uid,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  logger.info('[birthday] done', result);
  return result;
}

async function notify(uid: string, hits: Hit[]) {
  const today = hits.filter((h) => h.daysAhead === 0);
  const soon = hits.filter((h) => h.daysAhead === 7);

  // 「今日が誕生日」を優先で 1 件表示、残りは件数のみ
  let title: string;
  let body: string;
  if (today.length > 0) {
    const first = today[0].customer.name;
    title = `🎂 ${first}さんの誕生日`;
    const extra = today.length - 1;
    const soonNote = soon.length > 0 ? ` / 7 日後: ${soon.length} 名` : '';
    body = extra > 0 ? `本日: ${today.length} 名${soonNote}` : `本日が誕生日です${soonNote}`;
  } else {
    const first = soon[0].customer.name;
    title = `🎂 ${first}さんの誕生日（7 日後）`;
    body = soon.length > 1 ? `7 日後に誕生日: ${soon.length} 名` : '7 日後が誕生日です';
  }

  const firstId =
    today[0]?.customer.id ?? soon[0]?.customer.id ?? '';

  return sendToUser(
    uid,
    {
      title,
      body,
      data: {
        type: 'customer_birthday',
        customerId: firstId,
      },
    },
    FN_NAME,
  );
}
