/**
 * Cloud Functions 内で参照する Firestore ドキュメント型。
 * Web/iOS の型定義（src/lib/types/index.ts）と完全一致させること。
 * iOS 側 (yorulog-ios) も読み取り対象のため、フィールド追加時は両方に共有。
 */
import { Timestamp } from 'firebase-admin/firestore';

export interface NotificationPrefs {
  birthday?: boolean;
  nextAction?: boolean;
  longTimeNoSee?: boolean;
  dailySummary?: boolean;
}

/** UserProfile（crm_profiles/{uid}）の通知配信に必要な部分集合 */
export interface UserProfileLite {
  notificationPrefs?: NotificationPrefs;
}

/** デフォルト値（src/lib/types/index.ts の DEFAULT_NOTIFICATION_PREFS と一致） */
export const DEFAULT_NOTIFICATION_PREFS: Required<NotificationPrefs> = {
  birthday: true,
  nextAction: true,
  longTimeNoSee: true,
  dailySummary: false,
};

/** crm_push_tokens/{uid} の構造 */
export interface PushTokenDoc {
  token: string;
  platform?: string; // 'ios' | 'android' | 'web' | UA 文字列
  updatedAt?: string;
}

/** Workspace member doc（ownerUid 経由で workspace を引く用） */
export interface WorkspaceLite {
  id: string;
  ownerUid: string;
  name?: string;
  type?: string;
}

/** Customer のうち通知判定に必要な部分集合 */
export interface CustomerLite {
  id: string;
  name: string;
  birthday: string | null;        // 'YYYY-MM-DD' or 'MM-DD'
  lastContactAt: Timestamp | null;
  totalSales: number;
  nextAction: string | null;
  nextActionDue: Timestamp | null;
}

/** ContactLog の集計に必要な部分集合 */
export interface ContactLogLite {
  id: string;
  type: string;
  datetime: Timestamp;
  salesAmount: number;
  countAsGroup?: boolean | null;
}
