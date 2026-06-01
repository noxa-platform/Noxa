/**
 * Push 配信統計の集計ヘルパー。
 *
 * crm_push_stats/{YYYY-MM-DD} に以下のフィールドを累積する:
 *   - sent              : 送信成功数（種別不問）
 *   - failed            : 送信失敗数（無効トークン以外のエラー）
 *   - invalidTokenDeleted: 無効トークン検知で token doc を削除した数
 *   - byFn.{fnName}.sent / .failed : function 別内訳
 *
 * 失敗詳細は crm_push_failures/{YYYY-MM-DD}/items/{autoId} にも個別記録。
 * リトライ判断や問題切り分けの用途。
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../admin';

export type StatField = 'sent' | 'failed' | 'invalidTokenDeleted';

/** JST の YYYY-MM-DD を返す（cron が JST 9:00 起動なので JST 日付で集計） */
function jstDateKey(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 統計を 1 件分インクリメント */
export async function incrementStat(
  fnName: string,
  field: StatField,
  count = 1,
): Promise<void> {
  const dateKey = jstDateKey();
  const ref = db().doc(`notification_push_stats/${dateKey}`);
  try {
    await ref.set(
      {
        [field]: FieldValue.increment(count),
        byFn: {
          [fnName]: {
            [field]: FieldValue.increment(count),
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    // 集計失敗は本処理を止めない
    console.error(`[stats] increment failed fn=${fnName} field=${field}`, err);
  }
}

/** 配信失敗の詳細を crm_push_failures に記録（リトライ判断用） */
export async function recordFailure(params: {
  fnName: string;
  uid: string;
  code: string;
  message: string;
  invalidToken: boolean;
}): Promise<void> {
  const dateKey = jstDateKey();
  try {
    await db().collection(`notification_push_failures/${dateKey}/items`).add({
      fnName: params.fnName,
      uid: params.uid,
      code: params.code,
      message: params.message,
      invalidToken: params.invalidToken,
      at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[stats] recordFailure failed', err);
  }
}

/** 直近 N 日の統計を取得（dev/push-test 用） */
export interface PushStatsDoc {
  date: string;
  sent: number;
  failed: number;
  invalidTokenDeleted: number;
  byFn?: Record<string, { sent?: number; failed?: number; invalidTokenDeleted?: number }>;
}

export async function loadRecentStats(days = 7): Promise<PushStatsDoc[]> {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(now.getTime() + 9 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${dd}`);
  }
  const results: PushStatsDoc[] = [];
  for (const date of dates) {
    const snap = await db().doc(`notification_push_stats/${date}`).get();
    if (!snap.exists) {
      results.push({ date, sent: 0, failed: 0, invalidTokenDeleted: 0 });
      continue;
    }
    const data = snap.data() ?? {};
    results.push({
      date,
      sent: (data.sent as number | undefined) ?? 0,
      failed: (data.failed as number | undefined) ?? 0,
      invalidTokenDeleted: (data.invalidTokenDeleted as number | undefined) ?? 0,
      byFn: (data.byFn as PushStatsDoc['byFn']) ?? undefined,
    });
  }
  return results;
}
