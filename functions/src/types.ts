/**
 * Cloud Functions 内で参照する Firestore ドキュメント型。
 * Web/iOS の型定義（src/lib/types/index.ts）と完全一致させること。
 * iOS 側 (yorulog-ios) も読み取り対象のため、フィールド追加時は両方に共有。
 */
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

/** 通知判定の対象ワークスペース（所有店舗 / 所属店舗 / MyDeck） */
export interface WorkspaceLite {
  id: string;
  /** 所有店舗・MyDeck のみ判明。所属店舗は逆引き index から作るため未取得（Day120） */
  ownerUid?: string;
  name?: string;
  type?: string;
}

/**
 * Customer のうち通知判定に必要な部分集合。
 *
 * ⚠️ **時刻はミリ秒（number）で持つ**（P166）。Firestore の生の値をそのまま
 * `Timestamp` として運ぶと、読み手が `.toMillis()` を直接呼ぶ形になり、
 * number や ISO 文字列で保存された値が来たときに**その利用者の通知が丸ごと throw で消える**。
 * 形を揃える責任は読み出し側（`listCustomers`）に置き、ここから先は 1 つの形しか流れない。
 */
export interface CustomerLite {
  id: string;
  name: string;
  birthday: string | null;        // 'YYYY-MM-DD' or 'MM-DD'
  /** 最終接触（ミリ秒）。読めない形・未設定は null */
  lastContactAt: number | null;
  totalSales: number;
  nextAction: string | null;
  /** 次回アクション期限（ミリ秒）。読めない形・未設定は null */
  nextActionDue: number | null;
}

/** ContactLog の集計に必要な部分集合 */
export interface ContactLogLite {
  id: string;
  type: string;
  /** 記録時刻（ミリ秒）。読めない形は null（範囲クエリは通っているので通常は入る） */
  datetime: number | null;
  salesAmount: number;
  countAsGroup?: boolean | null;
}
