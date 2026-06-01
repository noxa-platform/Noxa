/**
 * notificationPrefs ON のユーザー uid 一覧を取得するヘルパー。
 * - crm_profiles/{uid}.notificationPrefs を全件走査
 * - 未設定の場合は DEFAULT_NOTIFICATION_PREFS にフォールバック
 * - ユーザー数が大きくなったら index + where 句に切替（現状は MVP）
 */
import { db } from '../admin';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefs,
  UserProfileLite,
} from '../types';

type PrefKey = keyof Required<NotificationPrefs>;

export async function listUidsWithPrefEnabled(key: PrefKey): Promise<string[]> {
  // v2: notificationPrefs は account_app_settings/{uid}.notificationPrefs に移動。
  // 旧 crm_profiles 由来データの互換のため、まず account_app_settings をスキャン。
  const snap = await db().collection('account_app_settings').get();
  const result: string[] = [];
  snap.forEach((doc) => {
    const data = doc.data() as UserProfileLite | undefined;
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(data?.notificationPrefs ?? {}) };
    if (prefs[key]) result.push(doc.id);
  });
  return result;
}
