/**
 * 次回アクション期限リマインダー: 毎日 9:00 JST。
 * nextActionDue <= 今日 の顧客が居れば件数で通知。
 */
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { listUidsWithPrefEnabled } from '../lib/prefs';
import { listOwnedWorkspaces, listCustomers } from '../lib/workspaces';
import { sendToUser } from '../lib/push';
import { jstStartOfToday } from '../lib/datetime';
import type { RunResult } from './birthday';

const FN_NAME = 'next-action';

export async function runNextActionReminder(): Promise<RunResult> {
  const uids = await listUidsWithPrefEnabled('nextAction');
  logger.info('[next-action] start', { targetCount: uids.length });

  // 今日の 23:59 をしきい値（JST 当日中の予定は当日通知に含めたい）
  const todayStart = jstStartOfToday();
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const cutoff = Timestamp.fromDate(todayEnd);

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
      let dueCount = 0;
      let firstName = '';
      let firstId = '';
      for (const ws of workspaces) {
        const customers = await listCustomers(ws.id);
        for (const c of customers) {
          if (!c.nextAction || !c.nextActionDue) continue;
          if (c.nextActionDue.toMillis() < cutoff.toMillis()) {
            dueCount += 1;
            if (!firstName) {
              firstName = c.name;
              firstId = c.id;
            }
          }
        }
      }
      if (dueCount === 0) continue;
      result.notifyCount += 1;
      const outcome = await sendToUser(
        uid,
        {
          title: `📋 ${dueCount} 件のアクションが期限到来`,
          body:
            dueCount === 1
              ? `${firstName}さん: 期限到来`
              : `${firstName}さん他 ${dueCount - 1} 名`,
          data: {
            type: 'next_action_due',
            customerId: firstId,
            count: String(dueCount),
          },
        },
        FN_NAME,
      );
      if (outcome === 'sent') result.sentCount += 1;
      else if (outcome === 'failed') result.failedCount += 1;
    } catch (err) {
      result.errorCount += 1;
      logger.error('[next-action] uid failed', {
        fnName: FN_NAME,
        uid,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  logger.info('[next-action] done', result);
  return result;
}
