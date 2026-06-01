/**
 * 毎日サマリー: 毎日 9:00 JST。
 * - 前日の売上合計 + 組数
 * - 当日の予定アクション数 (nextActionDue が今日中)
 */
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { listUidsWithPrefEnabled } from '../lib/prefs';
import { listOwnedWorkspaces, listCustomers, listLogsInRange } from '../lib/workspaces';
import { sendToUser } from '../lib/push';
import { jstStartOfToday, jstStartOfYesterday } from '../lib/datetime';
import type { ContactLogLite } from '../types';
import type { RunResult } from './birthday';

const FN_NAME = 'daily-summary';

function isCountedAsGroup(log: ContactLogLite): boolean {
  if (log.countAsGroup === true) return true;
  if (log.countAsGroup === false) return false;
  return log.type === 'visit' || log.type === 'outside';
}

export async function runDailySummary(): Promise<RunResult> {
  const uids = await listUidsWithPrefEnabled('dailySummary');
  logger.info('[daily-summary] start', { targetCount: uids.length });

  const yStart = jstStartOfYesterday();
  const tStart = jstStartOfToday();
  const tEnd = new Date(tStart.getTime() + 24 * 60 * 60 * 1000);
  const todayCutoff = Timestamp.fromDate(tEnd);

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
      let salesTotal = 0;
      let groupTotal = 0;
      let plannedTotal = 0;
      for (const ws of workspaces) {
        const logs = await listLogsInRange(ws.id, yStart, tStart);
        for (const l of logs) {
          salesTotal += l.salesAmount;
          if (isCountedAsGroup(l)) groupTotal += 1;
        }
        const customers = await listCustomers(ws.id);
        for (const c of customers) {
          if (!c.nextActionDue) continue;
          if (c.nextActionDue.toMillis() <= todayCutoff.toMillis()) plannedTotal += 1;
        }
      }
      // 売上 0 / 予定 0 のときも通知する（無風日でも届くことが価値）
      const yen = `¥${salesTotal.toLocaleString('ja-JP')}`;
      result.notifyCount += 1;
      const outcome = await sendToUser(
        uid,
        {
          title: '📊 今日の予定と昨日の売上',
          body: `前日: ${yen} / ${groupTotal} 組 / 今日の予定: ${plannedTotal} 件`,
          data: {
            type: 'daily_summary',
            sales: String(salesTotal),
            groups: String(groupTotal),
            planned: String(plannedTotal),
          },
        },
        FN_NAME,
      );
      if (outcome === 'sent') result.sentCount += 1;
      else if (outcome === 'failed') result.failedCount += 1;
    } catch (err) {
      result.errorCount += 1;
      logger.error('[daily-summary] uid failed', {
        fnName: FN_NAME,
        uid,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
  logger.info('[daily-summary] done', result);
  return result;
}
