/**
 * v2 スキーマ型定義（Firebase ドメインリネーム v2 設計書準拠）
 *
 * 設計書: Obsidian/web-knowledge/20_cases/firebase-rename-v2-design-2026-05-22.md
 *
 * v1 (src/lib/types/index.ts) との関係:
 *   - v1: 既存 crm_workspaces / bars / users / affiliations の型
 *   - v2: 新 account_* / shop_shops / personal_* / audit_* / notification_* の型
 *
 * マイグレ完了後、アプリ本体は v2 のみを参照する。マイグレ期間中は
 * scripts/migrate-to-v2-schema.ts が v1 と v2 の両方を import して変換する。
 *
 * NOTE: Firestore Timestamp は admin SDK / client SDK で型が違うため、
 *   ここでは any 互換の Timestamp 風型を採用する。実装時は呼び出し側で
 *   admin / client のいずれかにキャストする。
 */
import type { Timestamp } from 'firebase/firestore';
import type {
  OptionalEntry,
  OptionalGoal,
  Place,
  SnsAccounts,
  CustomerRank,
  CustomerColorTag,
  MbtiType,
  GenderOption,
  PlanTier,
  StoreType,
  NominationType,
} from '../index';

// ============================================================
// account ドメイン: ログイン主体 (個人 User と 1:1)
// ============================================================

/**
 * Firebase Auth UID と 1:1 のユーザー本体。
 * v1 の users + crm_profiles を統合。
 * isOwner / isCast は廃止（shop_shops/{shopId}/members で判定）。
 */
export interface AccountUser {
  id: string; // = Firebase Auth UID
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  handle?: string | null;
  avatar?: string | null; // 旧 photoURL
  platformRole: 'user' | 'admin'; // 旧 isAdmin
  // 同意系
  termsAgreedAt?: Timestamp | null;
  termsAgreedVersion?: string | null;
  privacyAgreedAt?: Timestamp | null;
  consentAcceptedAt?: Timestamp | null;
  consentVersion?: string | null;
  // 流入計測（一度だけ記録）
  acquisition?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
    referrer?: string;
    landingPath?: string;
    firstVisitAt?: string;
    registeredAt?: string;
  };
  onboardingCompleted?: boolean;
  status?: 'active' | 'inactive';
  // legacy 互換（マイグレ時にコピー、v2 ではほぼ参照しない）
  legacyStageName?: string;
  legacyRealName?: string;
  legacyStaffRole?: string;
  // メタ
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * AI クレジット / IAP プラン。v1 crm_subscriptions から Stripe フィールドを除去。
 */
export interface AccountSubscription {
  id: string; // = uid
  planTier: PlanTier;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete';
  aiCreditsTotal: number;
  aiCreditsUsed?: number;
  purchasedCredits?: number;
  seatBlocks: number;
  lastPurchaseAt?: Timestamp | null;
  currentPeriodEnd?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** v1 crm_iap_transactions そのまま */
export interface AccountIapTransaction {
  id: string;
  uid: string;
  productId: string;
  credits: number;
  priceJpy: number;
  environment: 'sandbox' | 'production';
  processedAt: Timestamp;
  signedDateMs?: number;
}

/** v1 crm_google_tokens そのまま */
export interface AccountGoogleToken {
  id: string; // = uid
  accessToken: string;
  refreshToken: string;
  expiresAt: Timestamp;
  updatedAt: Timestamp;
}

/** v1 user_premium そのまま (nomishugy プレミアム) */
export interface AccountPremium {
  id: string; // = uid
  tier?: string;
  startedAt?: Timestamp;
  expiresAt?: Timestamp | null;
  updatedAt: Timestamp;
}

/** v1 app_settings (ユーザー単位の通知 prefs 等) */
export interface AccountAppSettings {
  id: string; // = uid
  notificationPrefs?: {
    birthday?: boolean;
    nextAction?: boolean;
    longTimeNoSee?: boolean;
    dailySummary?: boolean;
  };
  updatedAt: Timestamp;
}

// ============================================================
// shop ドメイン: 店舗・共有データ所有主体
// ============================================================

export type ShopType = 'venue' | 'group' | 'org_branch';
export type ShopBusinessType =
  | 'host'
  | 'cabaret'
  | 'lounge'
  | 'girls_bar'
  | 'snack'
  | 'club'
  | 'bar'
  | 'fuzoku'
  | 'concafe'
  | 'gyara_nomi'
  | 'papa_katsu'
  | 'izakaya'
  | 'cafe'
  | 'other';

export type ShopMemberRole =
  | 'owner'
  | 'manager'
  | 'accounting'
  | 'cast'
  | 'staff'
  | 'readonly'
  | 'external';

/**
 * 公開バープロフィール - shop_public_profiles/{shopId}
 *
 * nomishugy のバー一覧・詳細ページ・SEO 用。誰でも read 可能。
 * Cloud Function trigger で shop_shops 書込時に同期 (name / area / hours / gallery 等)。
 * UGC バー (ownerUid=null) もここに doc を持つ。
 */
export interface ShopPublicProfile {
  id: string; // shop_shops と同じ ID
  ownerUid: string | null;
  source: 'owner_registered' | 'ugc' | 'imported';
  // 公開フィールド
  name: string;
  handle?: string | null;
  area?: string | null;
  description?: string | null;
  hours?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  seatCount?: number | null;
  gallery?: string[];
  tags?: string[];
  links?: Record<string, string>;
  businessType?: ShopBusinessType;
  is_published?: boolean;
  status?: 'draft' | 'pending' | 'published' | 'rejected';
  // 集計 (Cloud Function で aggregate)
  reviewCount?: number;
  avgRating?: number;
  checkinCount30d?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ShopMemberPermissions {
  can_view_sales?: boolean;
  can_edit_sales?: boolean;
  can_view_customers?: boolean;
  can_edit_customers?: boolean;
  can_view_payroll?: boolean;
  can_edit_payroll?: boolean;
  can_view_others_personal_sales?: boolean;
  can_export_csv?: boolean;
  can_edit_settings?: boolean;
  can_invite_members?: boolean;
}

/**
 * 店舗本体 (内部運営) — shop_shops/{shopId}
 *
 * 2026-05-25 改訂: 公開情報は shop_public_profiles/{shopId} に分離。
 * shop_shops は members のみ read 可能。Cloud Function で sync。
 */
export interface Shop {
  id: string;
  type: ShopType;
  businessType: ShopBusinessType;
  /**
   * 店舗オーナーの uid。null の場合は UGC バー (nomishugy ユーザーが作成、
   * 本オーナーが未クレーム)。後で claimShop フローでセット。
   */
  ownerUid: string | null;
  /**
   * バーがどう作られたかの記録。
   * - 'owner_registered': オーナー自身が yorulog/nomishugy 経由で正規登録
   * - 'ugc': nomishugy ユーザーが自由投稿（オーナー未登録）
   * - 'imported': 運営による一括インポート
   */
  source?: 'owner_registered' | 'ugc' | 'imported';
  claimedAt?: Timestamp | null; // ownerUid がセットされた日時
  organizationId?: string | null; // Phase 3 で使用
  // 表示系（nomishugy bar 由来）
  name: string;
  handle?: string | null;
  area?: string | null;
  description?: string | null;
  hours?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  seatCount?: number | null;
  gallery?: string[];
  tags?: string[];
  links?: Record<string, string>;
  is_published?: boolean;
  status?: 'draft' | 'pending' | 'published' | 'rejected';
  // 業態自由入力（v1 storeTypeName / businessCategory 互換）
  storeTypeName?: string;
  shopName?: string; // 旧 ws.shopName（業態カテゴリ表示名と分離）
  // ゴール系（旧 crm_workspaces business 由来）
  monthlyGoal?: number;
  monthlyGroupGoal?: number;
  monthlyGoals?: {
    salesGoal: number;
    shimeiGoal: number;
    douhanGoal: number;
    newCustomerGoal: number;
  };
  optionalGoals?: OptionalGoal[];
  salesGoalsByMonth?: Record<string, number>;
  annualSalesGoal?: Record<string, number>;
  groupGoalsByMonth?: Record<string, number>;
  presetVisitTypes?: { id: string; name: string }[];
  presetOptionalGoals?: {
    id: string;
    name: string;
    unit: OptionalGoal['unit'];
    monthlyTarget: number;
    monthlyTargetCount?: number;
    monthlyTargetAmount?: number;
  }[];
  customTags?: string[];
  customVisitTypes?: string[];
  customPlaces?: Place[];
  customPlaceTags?: string[];
  businessDayCutoffHour?: number;
  // AI 学習データ
  aiContribution?: boolean;
  // メタ
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * shop_shops/{shopId}/members/{uid}
 * 旧 affiliations（barapp） + 旧 crm_workspaces/{wid}/members の統合。
 */
export interface ShopMember {
  id: string; // = uid
  uid: string;
  role: ShopMemberRole;
  permissions?: ShopMemberPermissions;
  status: 'active' | 'inactive';
  castDisplayName?: string | null; // その店舗での源氏名
  castHandle?: string | null;
  availability?: {
    is_available?: boolean;
    updatedAt?: Timestamp;
  };
  joinedAt: Timestamp;
  leftAt?: Timestamp | null;
  invitedBy?: string | null;
  updatedAt: Timestamp;
}

/**
 * 店舗側売上 (個人 primary と saleId を共有)。
 * castUid=null はフリー客対応。
 */
export interface ShopSale {
  id: string;
  castUid?: string | null;
  castDisplayName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  amount: number;
  recordedBy: string;
  recordedVia: 'self' | 'shop' | 'terminal';
  recordedAt: Timestamp;
  optionalEntries?: OptionalEntry[];
  // POS 連動用（Phase 2）
  sessionId?: string;
  castSplit?: {
    castUid: string;
    amount: number;
    role: 'main' | 'jonai' | 'douhan' | 'help';
    reason: string;
    sourceOrderIds?: string[];
  }[];
  syncedToPersonal?: boolean;
  syncedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 店舗顧客台帳。Customer v1 と同じ構造を踏襲。 */
export interface ShopCustomer {
  id: string;
  name: string;
  nameKana?: string;
  tags: string[];
  birthday: string | null;
  mbti: MbtiType | string | null;
  likes: string[];
  likesNote: string;
  dislikes: string[];
  dislikesNote: string;
  ngItems: string[];
  ngNote: string;
  importantMemo: string;
  totalSales: number;
  lastContactAt: Timestamp | null;
  rank?: CustomerRank | null;
  colorTag?: CustomerColorTag | null;
  nextAction: string | null;
  nextActionDue: Timestamp | null;
  realName?: string;
  address?: string;
  bloodType?: string;
  phoneNumber?: string;
  email?: string;
  occupation?: string;
  personalMemo?: string;
  snsAccounts?: SnsAccounts;
  profileImageUrl?: string;
  lineRegisteredName?: string;
  nicknameForCustomer?: string;
  nicknameFromCustomer?: string;
  firstVisitAt?: Timestamp | null;
  visitCount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 旧 shifts (top) → shop_shops/{shopId}/shifts */
export interface ShopShift {
  id: string;
  castUserId: string;
  castName?: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  isPresent?: boolean;
  note?: string;
  createdAt: Timestamp;
}

/** 旧 bar_goals → shop_shops/{shopId}/goals */
export interface ShopGoal {
  id: string;
  year: number;
  month: number;
  targetAmount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Daily Close (yorulog) → shop_shops/{shopId}/daily_close/{date} */
export interface ShopDailyClose {
  id: string; // = YYYY-MM-DD
  date: string;
  rows: {
    castUid: string;
    castName: string;
    customerName: string;
    salesAmount: number;
    nominationType: NominationType;
    drinkBack: number;
    bottleBack: number;
    adjustment: number;
    memo: string;
    createdBy: string;
  }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 端末アカウント（Phase 3 で使用） */
export interface ShopTerminal {
  id: string;
  name: string;
  type: 'pos' | 'reception' | 'hall' | 'kitchen';
  permissions: Record<string, boolean>;
  pinHash: string;
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: Timestamp;
  lastUsedAt?: Timestamp;
  ipWhitelist?: string[];
  deviceFingerprint?: string;
}

/** 招待コード */
export interface ShopInvite {
  id: string; // = code
  shopId: string;
  role: ShopMemberRole;
  permissions?: ShopMemberPermissions;
  expiresAt?: Timestamp | null;
  maxUses?: number;
  usedCount?: number;
  createdBy: string;
  createdAt: Timestamp;
}

// ============================================================
// personal ドメイン (MyDeck): 個人専用データ
// ============================================================

/** personal_customers/{uid}/items/{cid} — 個人キャストの客カルテ */
export type PersonalCustomer = ShopCustomer & {
  // 追加: AI 学習データ（個人専用）
  chatHistory?: {
    sender: 'me' | 'customer';
    text: string;
    mood?: 'positive' | 'neutral' | 'negative';
    analyzedAt?: string;
  }[];
  customerPersonality?: string;
  myMessageStyle?: string;
  chatAnalyzedAt?: Timestamp;
  personalityTraits?: string[];
  interests?: string[];
  triggerPositive?: string[];
  triggerNegative?: string[];
  communicationStyle?: string;
  myStyleForCustomer?: {
    tone?: string;
    emojiLevel?: 'none' | 'low' | 'mid' | 'high';
    avgLength?: number;
    signaturePhrases?: string[];
    notes?: string;
  };
};

/** personal_sales/{uid}/items/{sid} */
export interface PersonalSale {
  id: string;
  shopId?: string | null; // どの店舗で発生したか（null = どこにも属さない個人記録）
  datetime: Timestamp;
  salesAmount: number;
  groupCount?: number;
  memo?: string;
  place?: string;
  customerId?: string | null;
  customerName?: string | null;
  optionalEntries?: OptionalEntry[];
  // shop 側 sales と同 saleId 共有のための紐付け
  shopSaleId?: string | null;
  createdBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** personal_ai_threads/{uid}/items/{tid} */
export interface PersonalAiThread {
  id: string;
  title?: string;
  ownerUid: string;
  messageCount?: number;
  messages?: { role: string; content: string; ts?: number }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** personal_templates/{uid}/items/{tid} — 文面テンプレ */
export interface PersonalTemplate {
  id: string;
  title?: string;
  body: string;
  tags?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** personal_goals/{uid}/items/{gid} — 個人月間目標 */
export interface PersonalGoal {
  id: string; // 例: '2026-05'
  yearMonth: string;
  salesGoal?: number;
  shimeiGoal?: number;
  douhanGoal?: number;
  newCustomerGoal?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** personal_self_styles/{uid} (単一 doc) — 旧 ai_profile/self */
export interface PersonalSelfStyle {
  id: string; // = uid
  stageName?: string;
  staffRole?: string;
  gender?: GenderOption;
  firstPerson?: string;
  defaultTone?: string;
  emojiLevel?: 'none' | 'low' | 'mid' | 'high';
  avgLength?: number;
  signaturePhrases?: string[];
  strongPoints?: string[];
  weakPoints?: string[];
  workStyle?: string;
  updatedAt: Timestamp;
}

/** personal_reminders/{uid}/items/{rid} */
export interface PersonalReminder {
  id: string;
  type: 'birthday' | 'inactive' | 'next_action';
  customerId: string;
  customerName: string;
  dueDate: Timestamp;
  dismissed: boolean;
  snoozedUntil?: Timestamp | null;
  createdAt: Timestamp;
}

// ============================================================
// audit ドメイン: 監査ログ・通報・問い合わせ
// ============================================================

export interface AuditLog {
  id: string;
  uid: string;
  workspaceId?: string | null; // shop_shops/{shopId}（該当時）
  action: string; // 'sale.create' | 'customer.delete' | ...
  targetType: string;
  targetId?: string | null;
  diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Timestamp;
}

export interface AuditContactMessage {
  id: string;
  uid?: string | null;
  name?: string;
  email?: string;
  body: string;
  createdAt: Timestamp;
}

export interface AuditAcquisitionEvent {
  id: string;
  uid?: string | null;
  type: string;
  attribution?: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface AuditWaitlistSignup {
  id: string;
  email: string;
  source?: string;
  createdAt: Timestamp;
}

export interface AuditCrowdfundingSupporter {
  id: string;
  uid?: string | null;
  name?: string;
  amount?: number;
  createdAt: Timestamp;
}

export interface AuditReport {
  id: string;
  reporterUid: string;
  targetType: 'user' | 'bar' | 'post' | 'review' | 'other';
  targetId: string;
  reason: string;
  detail?: string;
  status?: 'open' | 'reviewing' | 'resolved' | 'rejected';
  createdAt: Timestamp;
}

// ============================================================
// notification ドメイン
// ============================================================

export interface NotificationInbox {
  id: string;
  uid: string;
  type: string;
  title: string;
  body?: string;
  readAt?: Timestamp | null;
  createdAt: Timestamp;
}

export interface NotificationPushToken {
  id: string; // = uid
  tokens: { token: string; platform: 'ios' | 'android' | 'web'; updatedAt: Timestamp }[];
  updatedAt: Timestamp;
}

// ============================================================
// bar / match / recruit / reward / master / noxa ドメイン
// （Phase 1 マイグレ時点では主にコレクション名のリネームのみ。
//  ペイロード型は v1 をそのまま引き継ぐので、ここでは alias 宣言に留める）
// ============================================================

// 旧 timeline (23) → bar_journal
export interface BarJournal {
  id: string;
  title: string;
  slug?: string;
  body?: string;
  description?: string;
  genre?: string;
  authorName?: string;
  authorRole?: string;
  image?: string;
  imageUrl?: string;
  is_published?: boolean;
  status?: string;
  likeCount?: number;
  viewCount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 旧 sakunomi_* → match_*
export interface MatchRecruitment {
  id: string;
  creatorUserId: string;
  creatorProfile?: Record<string, unknown>;
  barId?: string;
  areaId?: string;
  conditions?: Record<string, unknown>;
  autoApprove?: boolean;
  status: 'OPEN' | 'MATCHED' | 'CANCELLED' | 'EXPIRED';
  createdAt: Timestamp;
}

// 旧 columns → 削除予定（移行しない）

// ============================================================
// パス生成ヘルパー（v2）
// ============================================================

export const pathsV2 = {
  // account
  accountUsers: () => 'account_users',
  accountUser: (uid: string) => `account_users/${uid}`,
  accountSubscriptions: () => 'account_subscriptions',
  accountSubscription: (uid: string) => `account_subscriptions/${uid}`,
  accountIapTransactions: () => 'account_iap_transactions',
  accountIapTransaction: (id: string) => `account_iap_transactions/${id}`,
  accountGoogleTokens: () => 'account_google_tokens',
  accountGoogleToken: (uid: string) => `account_google_tokens/${uid}`,
  accountPremium: () => 'account_premium',
  accountPremiumDoc: (uid: string) => `account_premium/${uid}`,
  accountAppSettings: () => 'account_app_settings',
  accountAppSetting: (uid: string) => `account_app_settings/${uid}`,
  accountFollows: () => 'account_follows',

  // shop
  shops: () => 'shop_shops',
  shop: (shopId: string) => `shop_shops/${shopId}`,
  shopMembers: (shopId: string) => `shop_shops/${shopId}/members`,
  shopMember: (shopId: string, uid: string) => `shop_shops/${shopId}/members/${uid}`,
  shopSales: (shopId: string) => `shop_shops/${shopId}/sales`,
  shopSale: (shopId: string, saleId: string) => `shop_shops/${shopId}/sales/${saleId}`,
  shopCustomers: (shopId: string) => `shop_shops/${shopId}/customers`,
  shopCustomer: (shopId: string, cid: string) => `shop_shops/${shopId}/customers/${cid}`,
  shopShifts: (shopId: string) => `shop_shops/${shopId}/shifts`,
  shopShift: (shopId: string, sid: string) => `shop_shops/${shopId}/shifts/${sid}`,
  shopGoals: (shopId: string) => `shop_shops/${shopId}/goals`,
  shopGoal: (shopId: string, gid: string) => `shop_shops/${shopId}/goals/${gid}`,
  shopPayrolls: (shopId: string, uid: string) => `shop_shops/${shopId}/payrolls/${uid}/items`,
  shopDailyClose: (shopId: string) => `shop_shops/${shopId}/daily_close`,
  shopDailyCloseDoc: (shopId: string, date: string) => `shop_shops/${shopId}/daily_close/${date}`,
  shopDailyAggregates: (shopId: string) => `shop_shops/${shopId}/daily_aggregates`,
  shopAiThreads: (shopId: string) => `shop_shops/${shopId}/ai_threads`,
  shopTerminals: (shopId: string) => `shop_shops/${shopId}/terminals`,
  shopInvites: (shopId: string) => `shop_shops/${shopId}/invites`,
  shopPosConfig: (shopId: string) => `shop_shops/${shopId}/pos_config/main`,
  shopMenus: (shopId: string) => `shop_shops/${shopId}/menus`,
  shopTables: (shopId: string) => `shop_shops/${shopId}/tables`,
  shopSessions: (shopId: string) => `shop_shops/${shopId}/sessions`,
  shopSessionOrders: (shopId: string, sid: string) => `shop_shops/${shopId}/sessions/${sid}/orders`,
  shopPayrollRules: (shopId: string) => `shop_shops/${shopId}/payroll_rules`,
  shopPayments: (shopId: string) => `shop_shops/${shopId}/payments`,
  shopTabs: (shopId: string) => `shop_shops/${shopId}/tabs`,
  shopAnalytics: (shopId: string) => `shop_shops/${shopId}/analytics`,
  shopBoosts: (shopId: string) => `shop_shops/${shopId}/boosts`,

  // personal (MyDeck)
  personalCustomers: (uid: string) => `personal_customers/${uid}/items`,
  personalCustomer: (uid: string, cid: string) => `personal_customers/${uid}/items/${cid}`,
  personalAiThreads: (uid: string) => `personal_ai_threads/${uid}/items`,
  personalTemplates: (uid: string) => `personal_templates/${uid}/items`,
  personalGoals: (uid: string) => `personal_goals/${uid}/items`,
  personalSelfStyle: (uid: string) => `personal_self_styles/${uid}`,
  personalSales: (uid: string) => `personal_sales/${uid}/items`,
  personalSale: (uid: string, sid: string) => `personal_sales/${uid}/items/${sid}`,
  personalReminders: (uid: string) => `personal_reminders/${uid}/items`,

  // audit
  auditLogs: () => 'audit_logs',
  auditLog: (id: string) => `audit_logs/${id}`,
  auditReports: () => 'audit_reports',
  auditContactMessages: () => 'audit_contact_messages',
  auditAcquisitionEvents: () => 'audit_acquisition_events',
  auditWaitlistSignups: () => 'audit_waitlist_signups',
  auditCrowdfundingSupporters: () => 'audit_crowdfunding_supporters',

  // notification
  notificationInbox: () => 'notification_inbox',
  notificationPushTokens: () => 'notification_push_tokens',
  notificationPushFailures: () => 'notification_push_failures',
  notificationPushStats: () => 'notification_push_stats',

  // bar (集客)
  barReviews: () => 'bar_reviews',
  barFavorites: () => 'bar_favorites',
  barCheckins: () => 'bar_checkins',
  barEvents: () => 'bar_events',
  barCoupons: () => 'bar_coupons',
  barReservations: () => 'bar_reservations',
  barBanners: () => 'bar_banners',
  barTips: () => 'bar_tips',
  barJournal: () => 'bar_journal',
  barBoosts: () => 'bar_boosts',
  barSpotjobs: () => 'bar_spotjobs',
  barSpotjobsApplications: () => 'bar_spotjobs_applications',
  barSpotjobsRatings: () => 'bar_spotjobs_ratings',
  barSpotjobsCertifications: () => 'bar_spotjobs_certifications',
  barSpotjobsProfiles: () => 'bar_spotjobs_profiles',
  barSpotjobsNominations: () => 'bar_spotjobs_nominations',

  // recruit
  recruitJobs: () => 'recruit_jobs',
  recruitApplications: () => 'recruit_applications',

  // match (旧 sakunomi、Feature Flag で非表示にする)
  matchRecruitments: () => 'match_recruitments',
  matchMatches: () => 'match_matches',
  matchSwipes: () => 'match_swipes',
  matchProfiles: () => 'match_profiles',
  matchLogs: () => 'match_logs',
  matchQuickMessages: () => 'match_quick_messages',
  matchRatings: () => 'match_ratings',
  matchChats: (matchId: string) => `match_chats/${matchId}/messages`,

  // reward (旧 crm_missions / crm_referral_*)
  rewardMissions: (uid: string) => `reward_missions/${uid}/items`,
  rewardReferralCodes: () => 'reward_referral_codes',
  rewardReferralOwners: () => 'reward_referral_owners',
  rewardGrants: (uid: string) => `reward_grants/${uid}/items`,
  rewardCampaigns: () => 'reward_campaigns',

  // master (運営マスター、全プロダクト read)
  masterBusinessTypes: () => 'master_business_types',
  masterAreas: () => 'master_areas',
  masterDistricts: () => 'master_districts',
  masterNgwords: () => 'master_ngwords',
  masterComplianceRules: () => 'master_compliance_rules',
  masterAiKnowledge: () => 'master_ai_knowledge',

  // noxa (Phase 1 新規実装)
  noxaUsers: () => 'noxa_users',
  noxaBoards: () => 'noxa_boards',
  noxaPosts: () => 'noxa_posts',
  noxaComments: () => 'noxa_comments',
  noxaLikes: () => 'noxa_likes',
  noxaReports: () => 'noxa_reports',
  noxaInvites: () => 'noxa_invites',
  noxaUserSettings: () => 'noxa_user_settings',
} as const;

// ============================================================
// 旧コレクション名（マイグレ元、削除予定）
// ============================================================

export const pathsLegacy = {
  // 削除対象
  crmLineConfig: () => 'crm_line_config',
  processedStripeEvents: () => 'processed_stripe_events',
  columns: () => 'columns',
  aiKnowledge: () => 'ai_knowledge',
  // マイグレ元
  users: () => 'users',
  follows: () => 'follows',
  userPremium: () => 'user_premium',
  appSettings: () => 'app_settings',
  notifications: () => 'notifications',
  contactMessages: () => 'contact_messages',
  reports: () => 'reports',
  acquisitionEvents: () => 'acquisition_events',
  waitlistSignups: () => 'waitlist_signups',
  crowdfundingSupporters: () => 'crowdfunding_supporters',
  bars: () => 'bars',
  affiliations: () => 'affiliations',
  shifts: () => 'shifts',
  sales: () => 'sales',
  barGoals: () => 'bar_goals',
  barAnalytics: () => 'bar_analytics',
  availability: () => 'availability',
  events: () => 'events',
  favorites: () => 'favorites',
  reviews: () => 'reviews',
  checkins: () => 'checkins',
  coupons: () => 'coupons',
  reservations: () => 'reservations',
  banners: () => 'banners',
  tips: () => 'tips',
  timeline: () => 'timeline',
  boosts: () => 'boosts',
  jobs: () => 'jobs',
  jobApplications: () => 'job_applications',
  spotJobs: () => 'spot_jobs',
  spotApplications: () => 'spot_applications',
  spotJobRatings: () => 'spot_job_ratings',
  bartenderCertifications: () => 'bartender_certifications',
  bartenderProfiles: () => 'bartender_profiles',
  nominations: () => 'nominations',
  sakunomiRecruitments: () => 'sakunomi_recruitments',
  sakunomiMatches: () => 'sakunomi_matches',
  sakunomiSwipes: () => 'sakunomi_swipes',
  sakunomiLogs: () => 'sakunomi_logs',
  userSakunomiProfiles: () => 'user_sakunomi_profiles',
  quickMessages: () => 'quick_messages',
  matchRatings: () => 'match_ratings',
  chats: () => 'chats',
  crmWorkspaces: () => 'crm_workspaces',
  crmProfiles: () => 'crm_profiles',
  crmSubscriptions: () => 'crm_subscriptions',
  crmIapTransactions: () => 'crm_iap_transactions',
  crmGoogleTokens: () => 'crm_google_tokens',
  crmPushTokens: () => 'crm_push_tokens',
  crmPushFailures: () => 'crm_push_failures',
  crmPushStats: () => 'crm_push_stats',
  crmReminders: () => 'crm_reminders',
  crmMissions: () => 'crm_missions',
  crmReferralCodes: () => 'crm_referral_codes',
  crmReferralOwners: () => 'crm_referral_owners',
  crmTestimonials: () => 'crm_testimonials',
  crmInvites: () => 'crm_invites',
  crmAiUsage: () => 'crm_ai_usage',
} as const;

// ============================================================
// v1 → v2 リネームマッピング（ドキュメント用）
// ============================================================

export const RENAME_MAP: Record<string, string | null> = {
  // null = 削除（マイグレしない）
  crm_line_config: null,
  processed_stripe_events: null,
  columns: null,
  ai_knowledge: null,
  crm_ai_usage: null, // 旧データ 0 件、新規はそのうち account_ai_usage で

  // account
  users: 'account_users',
  crm_profiles: 'account_users', // マージ
  user_premium: 'account_premium',
  app_settings: 'account_app_settings',
  follows: 'account_follows',
  crm_subscriptions: 'account_subscriptions',
  crm_iap_transactions: 'account_iap_transactions',
  crm_google_tokens: 'account_google_tokens',

  // shop / personal (分割マイグレ — 詳細はスクリプトで判定)
  bars: 'shop_shops',
  crm_workspaces: 'shop_shops|personal_*', // business → shop / personal → personal
  affiliations: 'shop_shops/{shopId}/members',
  shifts: 'shop_shops/{shopId}/shifts',
  sales: 'shop_shops/{shopId}/sales',
  bar_goals: 'shop_shops/{shopId}/goals',
  bar_analytics: 'shop_shops/{shopId}/analytics',
  availability: 'shop_shops/{shopId}/members/{uid}.availability',
  crm_reminders: 'personal_reminders/{uid}/items',

  // bar (集客)
  events: 'bar_events',
  favorites: 'bar_favorites',
  reviews: 'bar_reviews',
  checkins: 'bar_checkins',
  coupons: 'bar_coupons',
  reservations: 'bar_reservations',
  banners: 'bar_banners',
  tips: 'bar_tips',
  timeline: 'bar_journal',
  boosts: 'bar_boosts',

  // recruit / spotjobs
  jobs: 'recruit_jobs',
  job_applications: 'recruit_applications',
  spot_jobs: 'bar_spotjobs',
  spot_applications: 'bar_spotjobs_applications',
  spot_job_ratings: 'bar_spotjobs_ratings',
  bartender_certifications: 'bar_spotjobs_certifications',
  bartender_profiles: 'bar_spotjobs_profiles',
  nominations: 'bar_spotjobs_nominations',

  // match (旧 sakunomi)
  sakunomi_recruitments: 'match_recruitments',
  sakunomi_matches: 'match_matches',
  sakunomi_swipes: 'match_swipes',
  sakunomi_logs: 'match_logs',
  user_sakunomi_profiles: 'match_profiles',
  quick_messages: 'match_quick_messages',
  match_ratings: 'match_ratings', // 維持
  chats: 'match_chats',

  // reward
  crm_missions: 'reward_missions/{uid}/items',
  crm_referral_codes: 'reward_referral_codes',
  crm_referral_owners: 'reward_referral_owners',

  // audit / notification
  reports: 'audit_reports',
  audit_logs: 'audit_logs', // 維持
  contact_messages: 'audit_contact_messages',
  acquisition_events: 'audit_acquisition_events',
  waitlist_signups: 'audit_waitlist_signups',
  crowdfunding_supporters: 'audit_crowdfunding_supporters',
  crm_testimonials: 'audit_testimonials',
  notifications: 'notification_inbox',
  crm_push_tokens: 'notification_push_tokens',
  crm_push_failures: 'notification_push_failures',
  crm_push_stats: 'notification_push_stats',
  crm_invites: 'shop_shops/{shopId}/invites', // shop ごとに分配
};
