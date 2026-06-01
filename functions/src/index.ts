/**
 * YoruLog Cloud Functions エントリーポイント。
 *
 * 4 つの scheduled function を export:
 *   - birthdayReminder       誕生日（当日 / 7 日後）
 *   - nextActionReminder     次回アクション期限
 *   - longTimeNoSeeReminder  30 日連絡なし
 *   - dailySummary           前日売上 + 当日予定サマリー
 *
 * すべて毎日 09:00 JST に Cloud Scheduler でトリガー。
 * 通知 ON/OFF は crm_profiles/{uid}.notificationPrefs を尊重。
 *
 * 配信ロジックは notifications/*.ts に分割、共通の Push 送信は lib/push.ts。
 * Web (Service Worker) / iOS (APNs via FCM) / Android (FCM) の同一トークン
 * テーブル (crm_push_tokens/{uid}) を使う。
 *
 * iOS 側 (yorulog-ios) は読み取り側で、書き込みは Capacitor 同等の
 * APNs → FCM 経由トークンが既に存在する前提（本リポでは Web の FCM 登録のみ
 * 新規追加）。
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { runBirthdayReminder } from './notifications/birthday';
import { runNextActionReminder } from './notifications/next-action';
import { runLongTimeNoSeeReminder } from './notifications/long-time-no-see';
import { runDailySummary } from './notifications/daily-summary';

// 全 functions 共通の設定
setGlobalOptions({
  region: 'asia-northeast1', // 東京リージョン（Firestore も同リージョン）
  maxInstances: 5,
  memory: '512MiB',
  timeoutSeconds: 540, // 9 分（顧客数が多い場合に備える）
});

const COMMON_SCHEDULE_OPTS = {
  schedule: 'every day 09:00',
  timeZone: 'Asia/Tokyo',
  retryCount: 1,
} as const;

export const birthdayReminder = onSchedule(COMMON_SCHEDULE_OPTS, async () => {
  await runBirthdayReminder();
});

export const nextActionReminder = onSchedule(COMMON_SCHEDULE_OPTS, async () => {
  await runNextActionReminder();
});

export const longTimeNoSeeReminder = onSchedule(COMMON_SCHEDULE_OPTS, async () => {
  await runLongTimeNoSeeReminder();
});

export const dailySummary = onSchedule(COMMON_SCHEDULE_OPTS, async () => {
  await runDailySummary();
});

// 管理者専用 HTTP trigger（開発時のテスト送信用）。
// scheduled function 本体には影響しない薄い wrapper。詳細は admin/index.ts。
export {
  triggerBirthdayReminder,
  triggerNextActionReminder,
  triggerLongTimeNoSeeReminder,
  triggerDailySummary,
} from './admin-triggers';

// NOXA 認証関連 (Custom Token 発行 / アカウント完全削除 / 店舗デバイスログイン)
export {
  exchangeAuthToken,
  deleteNoxaAccount,
  storeDeviceLogin,
} from './noxa-auth';

// v2 schema 同期トリガー (shop_public_profiles sync / memberships 逆引き)
export {
  syncShopPublicProfile,
  syncMembershipIndex,
  syncShopNameToMemberships,
} from './v2-sync';

// AI クレジット ledger（消費を account_credit_ledger に記録）
export { consumeAiCredit } from './credits';

// UGC バー所有権 claim 申請
export { claimShop } from './claim-shop';
