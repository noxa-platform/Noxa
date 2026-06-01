/**
 * FCM 送信ヘルパー。
 * - `crm_push_tokens/{uid}` からトークンを取得
 * - 無効トークンは自動削除
 * - iOS (APNs) / Android / Web 共通フォーマット
 * - 各送信結果を crm_push_stats / crm_push_failures に集計
 */
import { FirebaseError } from 'firebase-admin/app';
import * as logger from 'firebase-functions/logger';
import { db, messaging } from '../admin';
import { incrementStat, recordFailure } from './stats';
import type { PushTokenDoc } from '../types';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** 送信結果（呼び出し側で件数集計に使う） */
export type SendOutcome = 'sent' | 'failed' | 'no-token';

/**
 * 1 ユーザーに通知を送信。
 * @param fnName 集計用の function 名（'birthday' / 'next-action' / ...）
 */
export async function sendToUser(
  uid: string,
  payload: PushPayload,
  fnName: string,
): Promise<SendOutcome> {
  const snap = await db().doc(`notification_push_tokens/${uid}`).get();
  if (!snap.exists) return 'no-token';
  const tokenDoc = snap.data() as PushTokenDoc | undefined;
  const token = tokenDoc?.token;
  if (!token) return 'no-token';

  try {
    await messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ?? {},
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'yorulog_default',
        },
      },
      webpush: {
        notification: {
          icon: '/icon.svg',
          badge: '/icon.svg',
        },
      },
    });
    await incrementStat(fnName, 'sent');
    return 'sent';
  } catch (err) {
    await handleSendError(uid, err, fnName);
    return 'failed';
  }
}

/** 無効トークンエラーなら token ドキュメントを削除 + 統計記録 */
async function handleSendError(uid: string, err: unknown, fnName: string): Promise<void> {
  const code = (err as FirebaseError | undefined)?.code ?? '';
  const message = (err as Error | undefined)?.message ?? String(err);
  // 失敗のたびに削除すると一時障害でも消えるので、明確に無効なコードだけ削除
  const invalidCodes = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
  ];
  const isInvalid = invalidCodes.includes(code);
  if (isInvalid) {
    logger.warn('invalid push token, deleting', { fnName, uid, code });
    try {
      await db().doc(`notification_push_tokens/${uid}`).delete();
      await incrementStat(fnName, 'invalidTokenDeleted');
    } catch (delErr) {
      logger.error('failed to delete invalid token', { fnName, uid, error: String(delErr) });
    }
  } else {
    logger.error('push send failed', { fnName, uid, code, message });
  }
  await incrementStat(fnName, 'failed');
  await recordFailure({ fnName, uid, code, message, invalidToken: isInvalid });
}
