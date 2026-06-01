/**
 * 久しぶり警告: 毎日 9:00 JST。
 * - lastContactAt < 今日 - 30 日
 * - 過去 365 日内に接触あり (totalSales > 0 で代用)
 * - 候補が居れば N 件まとめて通知
 */
import * as logger from 'firebase-functions/logger';
import { listUidsWithPrefEnabled } from '../lib/prefs';
import { listOwnedWorkspaces, listCustomers } from '../lib/workspaces';
import { sendToUser } from '../lib/push';
import { jstDaysAgo } from '../lib/datetime';
import type { RunResult } from './birthday';

const FN_NAME = 'long-time-no-see';

export async function runLongTimeNoSeeReminder(): Promise<RunResult> {
  const uids = await listUidsWithPrefEnabled('longTimeNoSee');
  logger.info('[long-time-no-see] start', { targetCount: uids.length });

  const threshold30 = jstDaysAgo(30).getTime();
  const threshold365 = jstDaysAgo(365).getTime();

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
      let matchCount = 0;
      let firstName = '';
      let firstId = '';
      for (const ws of workspaces) {
        const customers = await listCustomers(ws.id);
        for (const c of customers) {
          if (!c.lastContactAt) continue;
          const lastMs = c.lastContactAt.toMillis();
          // 過去 365 日内に接触あり、かつ 30 日以上連絡なし
          if (lastMs >= threshold365 && lastMs < threshold30 && c.totalSales > 0) {
            matchCount += 1;
            if (!firstName) {
              firstName = c.name;
              firstId = c.id;
            }
          }
        }
      }
      if (matchCount === 0) continue;
      result.notifyCount += 1;
      const outcome = await sendToUser(
        uid,
        {
          title: `😴 ${matchCount} 名のお客様と 30 日連絡なし`,
          body:
            matchCount === 1
              ? `${firstName}さんと久しぶりに連絡しませんか？`
              : `${firstName}さん他 ${matchCount - 1} 名`,
          data: {
            type: 'long_time_no_see',
            customerId: firstId,
            count: String(matchCount),
          },
        },
        FN_NAME,
      );
      if (outcome === 'sent') result.sentCount += 1;
      else if (outcome === 'failed') result.failedCount += 1;
    } catch (err) {
      result.errorCount += 1;
      logger.error('[long-time-no-see] uid failed', {
        fnName: FN_NAME,
        uid,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  logger.info('[long-time-no-see] done', result);
  return result;
}
