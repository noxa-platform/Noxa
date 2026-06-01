import { Timestamp } from 'firebase/firestore';

// 店舗業種
export type StoreType =
  | 'cabaret'
  | 'host'
  | 'lounge'
  | 'girls_bar'
  | 'snack'
  | 'club'
  | 'bar'
  | 'fuzoku'
  | 'gyara_nomi'
  | 'papa_katsu'
  | 'other';
export const STORE_TYPE_LABELS: Record<StoreType, string> = {
  cabaret: 'キャバクラ',
  host: 'ホストクラブ',
  lounge: 'ラウンジ',
  girls_bar: 'ガールズバー',
  snack: 'スナック',
  club: 'クラブ',
  bar: 'バー',
  fuzoku: '風俗',
  gyara_nomi: 'ギャラ飲み',
  papa_katsu: 'パパ活',
  other: 'その他',
};

// スタッフ役職
export type StaffRole = 'cast' | 'boy' | 'mama' | 'bartender' | 'manager' | 'owner_staff' | 'other';
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  cast: 'キャスト',
  boy: 'ボーイ',
  mama: 'ママ',
  bartender: 'バーテンダー',
  manager: 'マネージャー',
  owner_staff: 'オーナー',
  other: 'その他',
};

// ユーザープロフィール（アカウント単位、全 WS で共有される本人情報）
//
// 2026-05-11: 「職業／源氏名／文体／性別」はワークスペース単位の SelfBaseStyle に
// 集約する方針に変更。本体に残っている stageName / realName / staffRole は
// 後方互換のための読み取り互換フィールドであり、新規書込みは行わない
// （初回マイグレ時に SelfBaseStyle へコピーされる）。
export interface UserProfile {
  id: string;
  /** @deprecated 2026-05 以降は WS 単位の SelfBaseStyle.stageName を見る */
  stageName?: string;
  realName?: string;
  /** @deprecated 2026-05 以降は WS 単位の SelfBaseStyle.staffRole を見る */
  staffRole?: StaffRole;
  phoneNumber?: string;
  linkedBarappUid?: string; // barapp連携: users/{uid}と同一（通常同じFirebase Auth UID）
  lineLoginUserId?: string; // LINEログイン連携用のLINE UserID
  termsAgreedAt?: Timestamp; // 利用規約・PP同意日時
  termsAgreedVersion?: string; // 同意した規約バージョン（YYYY-MM-DD 形式）
  // UTM流入計測（登録時に1回だけ記録）
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
  /**
   * プッシュ通知種別ごとの ON/OFF。iOS 側 PushSettingsView と同じスキーマ。
   * 未設定（undefined）の場合は birthday / nextAction / longTimeNoSee は ON、dailySummary は OFF として扱う。
   * 2026-05-17 追加（Web の /settings/notifications で編集）。
   */
  notificationPrefs?: {
    birthday?: boolean;
    nextAction?: boolean;
    longTimeNoSee?: boolean;
    dailySummary?: boolean;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * 通知種別の既定値（未設定時のフォールバック）。
 * iOS 側 PushSettingsView の @AppStorage 既定値と一致させること。
 */
export const DEFAULT_NOTIFICATION_PREFS: Required<NonNullable<UserProfile['notificationPrefs']>> = {
  birthday: true,
  nextAction: true,
  longTimeNoSee: true,
  dailySummary: false,
};

// よく行く場所
//
// tags は「ジャンル + 用途」の自由タグ配列（例: ["イタリアン", "同伴", "高級"]）。
// 旧 category は単一カテゴリだったが、ジャンルと用途を両立できないため
// 2026-05-12 から tags 方式に移行。後方互換のため category も残し、
// 読み取り時に tags が空なら category を 1 タグとして合流させる。
export interface Place {
  name: string;
  address?: string;
  /** @deprecated tags に統合。読み取り時のみ参照、新規書き込みでは使わない */
  category?: string;
  /** ジャンル + 用途の自由タグ（複数選択可） */
  tags?: string[];
  memo?: string;
}

/**
 * 後方互換のため、category 単独 → tags 配列に正規化するヘルパー。
 * 表示・編集系のコードはすべて normalizePlaceTags() の結果を見れば良い。
 */
export function normalizePlaceTags(place: Place): string[] {
  if (place.tags && place.tags.length > 0) return place.tags;
  if (place.category) return [place.category];
  return [];
}

// ワークスペース種別
//   personal: 個人売上記録用。シングルユーザー前提、メンバー招待 UI を出さない。
//   business: 店舗運営用。owner + members（owner/editor/viewer）でチーム共有。
//             メンバーは事業 ws 本体に加えて「個人ビュー」（自分の uid に
//             createdBy フィルタした表示モード）も ws 一覧で並列表示される。
export type WorkspaceType = 'personal' | 'business';

/**
 * 自由オプション目標の集計単位。
 * - toggle: ON/OFF（指名あり / 同伴あり 等）。エントリでは true 件数を集計。
 * - count : 件数（チェキ枚数 / ドリンクバック数 等）。エントリの count を合算。
 * - amount: 金額（オプション売上 / 別会計 等）。salesAmount には加算しない。
 * - countAndAmount: 件数 + 金額の両方を記録（チェキ枚数 + その売上等）。
 */
export type OptionalGoalUnit = 'toggle' | 'count' | 'amount' | 'countAndAmount';

export interface OptionalGoal {
  id: string;
  name: string;
  unit: OptionalGoalUnit;
  /** 主目標値（toggle: ON 回数 / count: 件数 / amount: 金額）。countAndAmount は下の 2 つを使う */
  monthlyTarget: number;
  /** countAndAmount のときの件数目標 */
  monthlyTargetCount?: number;
  /** countAndAmount のときの金額目標 */
  monthlyTargetAmount?: number;
}

/**
 * 売上ログ (ContactLog) に記録する自由オプションの実績エントリ。
 * goalId は OptionalGoal.id を参照。目標が削除された後も name で履歴を保持。
 */
export interface OptionalEntry {
  goalId: string;
  name: string;
  unit: OptionalGoalUnit;
  toggle?: boolean;
  count?: number;
  amount?: number;
}

// ワークスペース（カテゴリ）
export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  // 既存マイグレ用にオプショナル。新規作成は必須化されている。
  // 値なし = 'personal' として扱う（マイグレ前の既存 ws の互換性維持）。
  type?: WorkspaceType;
  /**
   * 親事業ワークスペースへのリンク。
   * 個人 WS が事業 WS の配下に組み込まれた場合に、その事業 WS の id を入れる。
   * 事業 WS の owner / sub_owner は配下個人 WS の集計・顧客一覧を閲覧可能（実装は Phase 2）。
   * 解除可能で、解除すると個人 WS は単独 WS に戻る。
   * 2026-05-11 追加。
   */
  parentWorkspaceId?: string;
  calendarIds: string[];
  anonymousTitleMode: boolean;
  reminderSettings: {
    birthdayDaysBefore: number;
    inactiveDays: number;
  };
  customTags: string[];
  customVisitTypes: string[];
  customPlaces: Place[];
  /**
   * 「よく行く場所」用のカスタムタグマスタ（WS 単位で蓄積）。
   * プリセット（同伴/アフター/店外、焼肉/寿司/...）に加えて、ユーザーが
   * 自分で追加した「高級」「夜景」「ワイン」等を保持する。
   * 2026-05-12 追加。
   */
  customPlaceTags?: string[];
  monthlyGoal: number;
  /** 月間の組数目標（ホーム画面の「目標」2 列ブロックで使用、optional） */
  monthlyGroupGoal?: number;
  /**
   * 自由オプション目標（指名 / オプション / チェキ / ドリンクバック等）。
   * デフォルト無し。WS 設定からユーザーが都度追加。
   * salesAmount とは独立して集計される（売上には加算しない）。
   * 2026-05-14 追加（iOS 拡張と共有）。
   */
  optionalGoals?: OptionalGoal[];
  /**
   * 来店区分プリセット（固定 ID + 表示名）。リネームしても ID で同一視するため、
   * customVisitTypes（name のみ）とは別に保持する。WS 設定の「プリセット項目を編集」で編集。
   * 2026-05-15 追加（iOS 側は今後追従、それまでは Web 専用フィールド）。
   */
  presetVisitTypes?: { id: string; name: string }[];
  /**
   * オプション目標プリセット（固定 ID + 表示名 + unit + 月次目標）。
   * optionalGoals（実保存）とは独立した「ユーザーの編集中プリセット集」。
   * WS 設定の「プリセット項目を編集」で編集する。2026-05-15 追加。
   */
  presetOptionalGoals?: {
    id: string;
    name: string;
    unit: OptionalGoalUnit;
    monthlyTarget: number;
    monthlyTargetCount?: number;
    monthlyTargetAmount?: number;
  }[];
  /**
   * 営業日の切替時刻 (0-23)。夜職向け設定で、深夜営業のログを当日扱いするためのもの。
   * 例: 6 を設定すると 5/13 5:59 までのログは「5/12 の営業日」として集計される。
   * デフォルト / 未設定 = 0（標準カレンダー日付）。2026-05-12 追加。
   */
  businessDayCutoffHour?: number;
  monthlyGoals?: MonthlyGoals;
  /**
   * 月別の売上目標。キーは "YYYY-MM" 形式。
   * undefined / 未登録の月は monthlyGoals.salesGoal を既定として使う。
   * 2026-05-11 追加。
   */
  salesGoalsByMonth?: Record<string, number>;
  /**
   * 年間の売上目標。キーは "YYYY" 形式。
   * 月別合計とは独立に保存される（実績の年合計と比較する用途）。
   * 2026-05-11 追加。
   */
  annualSalesGoal?: Record<string, number>;
  /**
   * 月別の組数目標。キーは "YYYY-MM" 形式。未登録月は monthlyGroupGoal を使う。
   * iOS 版 yorulog-ios Workspace.groupGoalsByMonth と完全同期。
   * 2026-05-17 追加（iOS 追従）。
   */
  groupGoalsByMonth?: Record<string, number>;
  storeType?: StoreType;            // 互換性維持（内部推定用、UI からは廃止）
  storeTypeName?: string;           // 店舗業種の自由入力表示名（UI で設定）
  /**
   * iOS 版互換: 店舗名（チュートリアル Step 2 で入力、任意）。
   * Web の storeTypeName とは別軸（storeTypeName は業種カテゴリの表示名、
   * shopName は固有の店舗名）。両 OS で同一 Firestore ドキュメントを共有。
   * 2026-05-17 追加（iOS 追従）。Web 設定 UI から編集可能（2026-05-17）。
   */
  shopName?: string;
  /**
   * iOS 版互換: 事業形態（業態、自由文字列）。
   * Web の storeType (enum) と意味は近いが粒度が違うため別フィールドで併存。
   * 2026-05-17 追加（iOS 追従）。Web 設定 UI から編集可能（2026-05-17）。
   */
  businessCategory?: string;
  /**
   * iOS 版互換: オーナー自身の職種（自由文字列、例: "ホスト" / "キャバ嬢" / "スナックママ"）。
   * Web の SelfBaseStyle.staffRole と意味的に重複するが、iOS が Workspace 直下にも
   * 保存しているため alias として保持。Business WS の設定で編集する。
   * 2026-05-17 追加（iOS 追従）。Web 設定 UI から編集可能（2026-05-17）。
   */
  ownerOccupation?: string;
  /**
   * iOS 旧キー (occupation) で保存されたドキュメントとの互換用。
   * Personal WS のオーナー自身の職業として Web 設定 UI から編集可能（2026-05-17）。
   */
  occupation?: string;
  /**
   * iOS 版互換: nomishugy（旧 barapp）連携フラグ。
   * Web の linkedBarId と粒度が違う（こちらは Boolean、shopID は別フィールド）。
   * 新規書き込みは Web からは行わない（読み取り互換のみ）。2026-05-17 追加。
   */
  nomishugyLinked?: boolean;
  nomishugyShopID?: string;
  /**
   * iOS 版互換: AI 学習プロファイル（追加投入テキスト/画像参照）。
   * Web は API 直叩きで AI を呼ぶ設計のため AIProfile 構造体は持たないが、
   * iOS が書き込んだフィールドを保持できるよう型のみ追加。2026-05-17 追加。
   */
  aiProfile?: {
    textNotes?: string[];
    imageRefs?: string[];
    updatedAt?: Timestamp;
  };
  address?: string;
  phoneNumber?: string;
  businessHours?: string;
  linkedBarId?: string; // barapp連携: bars/{barId}
  // AI 品質向上への匿名化データ提供に同意しているか（新規 ws はデフォルト true、オプトアウト方式）。
  // 既存 ws で undefined の場合は false 扱い（後方互換）。
  aiContribution?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 既存 ws の type が undefined なら personal として扱う */
export function getWorkspaceType(ws: Pick<Workspace, 'type'>): WorkspaceType {
  return ws.type ?? 'personal';
}

// メンバーの細粒度閲覧権限（2026-05-11 追加）。
// role による既定の粒度を、owner が個別メンバーに対して上書きできる。
// undefined のキーは「role に従う」と解釈する（resolveMemberPermissions 参照）。
export interface MemberPermissions {
  canSeeAllCustomers?: boolean;  // 自分が作成した顧客以外も閲覧可
  canSeeAllSales?: boolean;      // 他人の売上を含む WS 全体の集計を閲覧可
  canSeeMembers?: boolean;       // メンバー管理ページ・ランキングなどを閲覧可
  canSeeBilling?: boolean;       // 課金・プラン情報を閲覧可
  canEditWorkspace?: boolean;    // WS 設定の編集可
}

export type MemberRole = 'owner' | 'sub_owner' | 'editor' | 'viewer';

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'オーナー',
  sub_owner: 'サブオーナー',
  editor: '編集者',
  viewer: '閲覧者',
};

export interface WorkspaceMember {
  // 後方互換のため string も許容（既存データは 'owner' / 'editor' / 'viewer'）
  role: MemberRole;
  permissions?: MemberPermissions;
  joinedAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * role + permissions overrides を解決して、最終的に有効な権限セットを返す。
 * - permissions のキーが明示されていればそれを優先
 * - 未指定は role 既定値を使う
 *
 * role 既定値:
 *   owner / sub_owner: 全 true（sub_owner は WS 削除と最終オーナー譲渡だけはチェックする想定）
 *   editor: customers/sales/members は true、billing/editWorkspace は false
 *   viewer: 全 false（= 自分が作った顧客のみ閲覧）
 */
export function resolveMemberPermissions(member: Pick<WorkspaceMember, 'role' | 'permissions'>): Required<MemberPermissions> {
  const defaults: Record<MemberRole, Required<MemberPermissions>> = {
    owner:     { canSeeAllCustomers: true,  canSeeAllSales: true,  canSeeMembers: true,  canSeeBilling: true,  canEditWorkspace: true  },
    sub_owner: { canSeeAllCustomers: true,  canSeeAllSales: true,  canSeeMembers: true,  canSeeBilling: false, canEditWorkspace: true  },
    editor:    { canSeeAllCustomers: true,  canSeeAllSales: true,  canSeeMembers: true,  canSeeBilling: false, canEditWorkspace: false },
    viewer:    { canSeeAllCustomers: false, canSeeAllSales: false, canSeeMembers: false, canSeeBilling: false, canEditWorkspace: false },
  };
  const base = defaults[member.role] ?? defaults.viewer;
  const overrides = member.permissions ?? {};
  return {
    canSeeAllCustomers: overrides.canSeeAllCustomers ?? base.canSeeAllCustomers,
    canSeeAllSales:     overrides.canSeeAllSales     ?? base.canSeeAllSales,
    canSeeMembers:      overrides.canSeeMembers      ?? base.canSeeMembers,
    canSeeBilling:      overrides.canSeeBilling      ?? base.canSeeBilling,
    canEditWorkspace:   overrides.canEditWorkspace   ?? base.canEditWorkspace,
  };
}

// MBTI 16タイプ
export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const;
export type MbtiType = typeof MBTI_TYPES[number];

// ワークスペース単位の「自分のベース文体」（crm_workspaces/{wid}/ai_profile/self）
export type GenderOption = 'female' | 'male' | 'other';
export const GENDER_LABELS: Record<GenderOption, string> = {
  female: '女性',
  male: '男性',
  other: 'その他・指定しない',
};

export interface SelfBaseStyle {
  // === プロファイル基本情報（2026-05-11 移動分）===
  // 「自分が何者か」は WS ごとに変わる（個人 = ホスト本人、事業 = ママ など）。
  // 同じアカウントでも所属する WS で職業や源氏名が違うため、UserProfile では
  // なく WS 単位の本書類で持つ。
  stageName?: string;                // 源氏名（その WS での名乗り）
  // 2026-05-11 追加変更: StaffRole enum で固定していたが、店舗の呼称（黒服 / 内勤 /
  // ヘルプ / 取締 / 役員 …）が多様なため自由入力に変更。旧 StaffRole 値も string
  // として保存・読み出しできる（後方互換）。
  staffRole?: string;                // 職業 / 役職（自由入力）
  // === 文体パラメータ ===
  gender?: GenderOption;             // 性別（文体推定・一人称デフォルトに使う）
  firstPerson?: string;              // 一人称（例: あたし / 私 / 俺 / うち 等、自由入力）
  defaultTone?: string;              // 例: 'カジュアル敬語ベース'
  emojiLevel?: 'none' | 'low' | 'mid' | 'high';
  avgLength?: number;                // 平均文字数
  signaturePhrases?: string[];       // よく使う言い回し
  strongPoints?: string[];           // 営業上の強み
  weakPoints?: string[];             // 苦手な話題
  workStyle?: string;                // 接客スタイルの自由記述
  updatedAt?: Timestamp;
}

// 顧客ランク
// 2026-05-13: 4 段階 (S/A/B/C) → 5 段階に拡張、SS を追加（既存データ互換）
// UI は星表示（5★=SS, 4★=S, 3★=A, 2★=B, 1★=C, 0★=未設定）
export type CustomerRank = 'SS' | 'S' | 'A' | 'B' | 'C';

export const RANK_LABELS: Record<CustomerRank, string> = {
  SS: 'SSランク',
  S: 'Sランク',
  A: 'Aランク',
  B: 'Bランク',
  C: 'Cランク',
};

export const RANK_COLORS: Record<CustomerRank, string> = {
  SS: 'text-amber-500',
  S: 'text-yellow-500',
  A: 'text-blue-500',
  B: 'text-green-500',
  C: 'text-gray-500',
};

// ランクと星数の対応（SS=5★ が最高、C=1★）
export const RANK_TO_STARS: Record<CustomerRank, number> = {
  SS: 5,
  S: 4,
  A: 3,
  B: 2,
  C: 1,
};

export const STARS_TO_RANK: Record<number, CustomerRank> = {
  5: 'SS',
  4: 'S',
  3: 'A',
  2: 'B',
  1: 'C',
};

// 顧客色分け（カードの左ボーダー / アクセント色）
export type CustomerColorTag =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray';

export interface ColorPreset {
  value: CustomerColorTag;
  label: string;
  /** Tailwind の bg クラス（左ボーダー / バッジ用） */
  bg: string;
  /** Tailwind の border クラス（カード左ボーダー用） */
  border: string;
  /** Tailwind の text クラス（ラベル等） */
  text: string;
}

export const CUSTOMER_COLOR_PRESETS: ColorPreset[] = [
  { value: 'red',    label: '赤',     bg: 'bg-red-500',    border: 'border-l-red-500',    text: 'text-red-600' },
  { value: 'orange', label: '橙',     bg: 'bg-orange-500', border: 'border-l-orange-500', text: 'text-orange-600' },
  { value: 'yellow', label: '黄',     bg: 'bg-yellow-500', border: 'border-l-yellow-500', text: 'text-yellow-600' },
  { value: 'green',  label: '緑',     bg: 'bg-emerald-500',border: 'border-l-emerald-500',text: 'text-emerald-600' },
  { value: 'blue',   label: '青',     bg: 'bg-blue-500',   border: 'border-l-blue-500',   text: 'text-blue-600' },
  { value: 'purple', label: '紫',     bg: 'bg-purple-500', border: 'border-l-purple-500', text: 'text-purple-600' },
  { value: 'pink',   label: 'ピンク', bg: 'bg-pink-500',   border: 'border-l-pink-500',   text: 'text-pink-600' },
  { value: 'gray',   label: 'グレー', bg: 'bg-gray-500',   border: 'border-l-gray-500',   text: 'text-gray-600' },
];

export function getColorPreset(value: string | null | undefined): ColorPreset | undefined {
  if (!value) return undefined;
  return CUSTOMER_COLOR_PRESETS.find((p) => p.value === value);
}

// 顧客
export interface SnsAccounts {
  twitter?: string;
  instagram?: string;
  tiktok?: string;
  other?: string;
}

export interface Customer {
  id: string;
  name: string;
  nameKana?: string;
  tags: string[];
  birthday: string | null; // "YYYY-MM-DD" or "MM-DD"（年不明時）
  mbti: string | null;
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
  /** 顧客カードの左ボーダー / アクセント色（任意、自由分類用） */
  colorTag?: CustomerColorTag | null;
  nextAction: string | null;
  nextActionDue: Timestamp | null;
  // 拡張プロフィール
  realName?: string;
  address?: string;
  bloodType?: string;
  phoneNumber?: string;
  email?: string;
  occupation?: string;
  personalMemo?: string;
  snsAccounts?: SnsAccounts;
  profileImageUrl?: string;
  // LINE / 呼び方（iOS 拡張から逆同期。AI 文面生成の精度向上）
  lineRegisteredName?: string;     // 自分の LINE で相手に付けたラベル
  nicknameForCustomer?: string;    // 自分→相手 の呼び方（例: 太郎ちゃん）
  nicknameFromCustomer?: string;   // 相手→自分 の呼び方（例: ゆーちゃん）
  firstVisitAt?: Timestamp | null;
  visitCount?: number;
  // スクショ学習データ（AI が自動更新）
  chatHistory?: { sender: 'me' | 'customer'; text: string; mood?: 'positive' | 'neutral' | 'negative'; analyzedAt?: string }[];
  customerPersonality?: string;
  myMessageStyle?: string;
  chatAnalyzedAt?: Timestamp;
  // AI 学習プロファイル（手入力・AI 生成の両方で育てる）
  personalityTraits?: string[];     // 例: ['社交的','褒められ好き','負けず嫌い']
  interests?: string[];             // 例: ['韓流','旅行','競馬']
  triggerPositive?: string[];       // 刺さる話題
  triggerNegative?: string[];       // 避けるべき話題（NG ではなく話題的な地雷）
  communicationStyle?: string;      // '短文・即レス・絵文字多め' 等の自由記述
  // 顧客ごとの自分の使い分け文体（返信生成時にベース文体より優先）
  myStyleForCustomer?: {
    tone?: string;                  // 例: 'タメ口ベース、たまに敬語'
    emojiLevel?: 'none' | 'low' | 'mid' | 'high';
    avgLength?: number;
    signaturePhrases?: string[];    // よく使う言い回し
    notes?: string;                 // その他メモ
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 接触ログ
export type LogType = 'visit' | 'douhan' | 'outside' | 'call' | 'message' | 'after' | 'other';
export type Reaction = 'good' | 'normal' | 'bad';

export interface ContactLog {
  id: string;
  type: LogType;
  visitType: string | null;
  datetime: Timestamp;
  place: string;
  memo: string;
  reaction: Reaction | null;
  /**
   * 5 段階星評価（1-5）。reaction (good/normal/bad) を置き換える新フィールド。
   * iOS と同期し、Firestore へは `rating` キーで保存。
   * 2026-05-15 追加。reaction とは並走可能（既存データ互換のため）。
   */
  rating?: number | null;
  /**
   * このログを「組数」としてカウントするか。
   * - undefined / null = 既定（type が visit / outside なら true、それ以外は false）
   * - true / false = ユーザーが明示指定
   * iOS と同期。フリー / ヘルプを対象外にしたい等の業種別調整用。
   * 2026-05-15 追加。
   */
  countAsGroup?: boolean | null;
  salesAmount: number;
  giftGiven: string | null;
  giftReceived: string | null;
  nextAction: string | null;
  nextActionDue: Timestamp | null;
  // 来店サブアクション（同伴・アフター）
  withDouhan?: boolean;
  douhanPlace?: string;
  douhanMemo?: string;
  douhanAmount?: number;
  withAfter?: boolean;
  afterPlace?: string;
  afterMemo?: string;
  afterAmount?: number;
  imageUrls?: string[];
  /**
   * 売掛（つけ）の入金状況。未設定 = 売掛ではない（即金扱い）。
   * - 'unpaid'  : 売掛登録済み、未入金
   * - 'partial' : 一部入金済み（paidAmount を参照）
   * - 'paid'    : 入金完了
   * 2026-05-12 追加。
   */
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  /** 入金済み額（partial のとき必須）。paid なら salesAmount と一致 */
  paidAmount?: number;
  /** 入金期日（任意） */
  paymentDueDate?: Timestamp | null;
  /**
   * 自由オプションの実績エントリ（指名 / オプション / チェキ等）。
   * Workspace.optionalGoals[].id を goalId に持つ。salesAmount には加算されない。
   * 2026-05-14 追加。
   */
  optionalEntries?: OptionalEntry[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * 顧客紐付けのない「日売」「組数」登録。
 *
 * ユースケース:
 * - 過去データ移行時、顧客リストが整備できていない段階で日売だけ先に積みたい
 * - ボーイ・内勤など、特定顧客ではなく「店舗の今日の合計」を記録したい
 * - 普段運用でも、店舗の組数や合計売上だけサクッと残したい場面
 *
 * 集計は ContactLog と並列で行う（タイムライン・月集計・目標進捗）。
 * 2026-05-12 追加。
 */
export interface StandaloneSale {
  id: string;
  /** いつの売上か */
  datetime: Timestamp;
  /** 売上額（必須） */
  salesAmount: number;
  /** 組数（任意、来店組数の記録用） */
  groupCount?: number;
  /** メモ */
  memo?: string;
  /** 場所・店舗内の区分など */
  place?: string;
  /** 作成者 uid（誰が記録したか） */
  createdBy?: string;
  /** 自由オプション実績エントリ（ContactLog と同じスキーマ）。2026-05-14 追加。 */
  optionalEntries?: OptionalEntry[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// プレゼント
export interface Gift {
  id: string;
  type: 'given' | 'received';
  item: string;
  date: string;
  logId: string | null;
  note: string;
  createdAt: Timestamp;
}

// リマインド
export type ReminderType = 'birthday' | 'inactive' | 'next_action';

export interface Reminder {
  id: string;
  workspaceId: string;
  ownerUid: string;
  type: ReminderType;
  customerId: string;
  customerName: string;
  dueDate: Timestamp;
  dismissed: boolean;
  snoozedUntil?: Timestamp | null;
  createdAt: Timestamp;
}

// Google Calendar トークン
export interface GoogleToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * 組数カウント対象か。countAsGroup が明示指定されていればそれを尊重、
 * 未指定（null/undefined = 旧データ）は後方互換で visit / outside のみ対象。
 * iOS の ContactLog.isCountedAsGroup と同等。
 */
export function isCountedAsGroup(log: Pick<ContactLog, 'type' | 'countAsGroup'>): boolean {
  if (log.countAsGroup === true) return true;
  if (log.countAsGroup === false) return false;
  return log.type === 'visit' || log.type === 'outside';
}

// ログ種別の表示名
// 2026-05-17: iOS 側 (yorulog-ios) のラベルに統一。
// - visit: '来店' → '売上'
// - outside: '店外' → '外出'
// - message: '連絡' → 'メッセージ'
// DB に保存される type 値（'visit'/'outside'/'message'）は変更しない。
export const LOG_TYPE_LABELS: Record<LogType, string> = {
  visit: '売上',
  douhan: '同伴',
  outside: '外出',
  call: '電話',
  message: 'メッセージ',
  after: 'アフター',
  other: 'その他',
};

// リアクションの表示名
export const REACTION_LABELS: Record<Reaction, string> = {
  good: '良い',
  normal: '普通',
  bad: '微妙',
};

// デフォルト来店種別
export const DEFAULT_VISIT_TYPES = ['新規', '正規', '同業', 'その他'];

// デフォルトタグ（初期登録用）
export const DEFAULT_TAGS = ['お酒好き', 'タバコNG', '話し上手', '太客', '新規', 'イベント好き'];

// ========================================
// 目標管理（マルチターゲット）
// ========================================

export interface MonthlyGoals {
  salesGoal: number;
  shimeiGoal: number;       // 指名数目標
  douhanGoal: number;       // 同伴数目標
  newCustomerGoal: number;  // 新規顧客数目標
}

export interface GoalProgress {
  sales: { current: number; goal: number; pct: number };
  shimei: { current: number; goal: number; pct: number };
  douhan: { current: number; goal: number; pct: number };
  newCustomer: { current: number; goal: number; pct: number };
}

// ========================================
// アニバーサリー
// ========================================

export type AnniversaryType = 'first_visit' | 'visit_count' | 'registration' | 'birthday';

export interface Anniversary {
  customerId: string;
  customerName: string;
  type: AnniversaryType;
  date: string;
  visitCount?: number;
  label: string;
  /** 誕生日記念日のときのみ。年齢（年不明なら null） */
  age?: number | null;
}

// ========================================
// チーム成績
// ========================================

export interface MemberStats {
  uid: string;
  displayName: string;
  role: string;
  totalSales: number;
  logCount: number;
  customerCount: number;
  douhanCount: number;
}

// ========================================
// BARAPP連携
// ========================================

export interface BarappBar {
  id: string;
  name: string;
  handle: string;
  area: string;
  ownerUid: string;
}

export interface BarappSyncStatus {
  lastSyncAt: Timestamp | null;
  syncedSalesCount: number;
  syncedProfileFields: string[];
}

// ========================================
// 課金・サブスクリプション
// ========================================

export type PlanTier = 'free' | 'pro' | 'business';

// 2026-05-18: Stripe 廃止。stripeCustomerId / stripeSubscriptionId は legacy フィールドとして
// 既存データ互換のため optional 残置（読み取り側で参照しても問題ないようにするためだけの存在）。
// 書き込み側（initFreeSubscription / IAP grant）はもう設定しない。
export interface BillingSubscription {
  id: string; // = uid
  /** @deprecated 2026-05-18 Stripe 廃止。既存データの読み取り互換用に optional 残置 */
  stripeCustomerId?: string | null;
  /** @deprecated 2026-05-18 Stripe 廃止。既存データの読み取り互換用に optional 残置 */
  stripeSubscriptionId?: string | null;
  planTier: PlanTier;
  status: 'active' | 'canceled' | 'past_due' | 'incomplete';
  aiCreditsTotal: number;
  aiCreditsUsed: number;
  seatBlocks: number; // 購入済み10人枠数（Business用、デフォルト0）
  /** IAP 経由で購入された永続クレジット残（iOS StoreKit / Android Play Billing 共通） */
  purchasedCredits?: number;
  currentPeriodEnd: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AiUsageLog {
  id: string;
  count: number;
  lastUsedAt: Timestamp;
}

// ========================================
// Daily Close（店舗向け日締め指名・バック集計）
// ========================================
// 設計方針:
// - 個人 CRM（cast_private）と店舗確定データ（store_confirmed）を物理分離
// - daily_close_rows / daily_close_disputes は「店舗が記録した数字」レイヤー
// - キャストは自分の行のみ閲覧可、編集は不可、異議申立のみ可
// - Firestore rules でハード分離（管理者の表示設定で柔軟にしない）

export type NominationType = 'honshimei' | 'jonai' | 'douhan' | 'none';

export const NOMINATION_TYPE_LABELS: Record<NominationType, string> = {
  honshimei: '本指名',
  jonai: '場内指名',
  douhan: '同伴',
  none: 'なし',
};

export interface DailyCloseRow {
  id: string;
  date: string;            // YYYY-MM-DD
  castUid: string;          // 対象キャスト（ワークスペースメンバー uid）
  castName: string;         // 表示用スナップショット
  customerName: string;     // 自由テキスト
  salesAmount: number;
  nominationType: NominationType;
  drinkBack: number;
  bottleBack: number;
  adjustment: number;
  memo: string;
  createdBy: string;        // 入力者 uid
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type DisputeStatus = 'open' | 'resolved' | 'rejected';

export interface DailyCloseDispute {
  id: string;
  rowId: string;
  castUid: string;
  message: string;
  status: DisputeStatus;
  responseMessage?: string;
  createdAt: Timestamp;
  resolvedAt?: Timestamp | null;
}

export interface DailyCloseCastSummary {
  castUid: string;
  castName: string;
  rowCount: number;
  totalSales: number;
  nominationCounts: Record<NominationType, number>;
  totalDrinkBack: number;
  totalBottleBack: number;
  totalAdjustment: number;
  totalBack: number;       // drink + bottle + adjustment
}

// プランごとの制限定数
// NOTE: 公開ベータ期間中は課金 UI 全面停止 + Free 上限撤廃中。
// プラン体系自体は別途再構成予定（LINE 軸は撤去済み）。
export const PLAN_LIMITS: Record<PlanTier, {
  maxCustomers: number;
  maxAiCredits: number;
  maxWorkspaces: number;
  maxMembers: number;
  hasAds: boolean;
  price: number;
  label: string;
}> = {
  free: {
    maxCustomers: Infinity,
    maxAiCredits: 50,
    maxWorkspaces: 1,
    maxMembers: 1,
    hasAds: true,
    price: 0,
    label: 'Free',
  },
  pro: {
    maxCustomers: 200,
    maxAiCredits: 1000,
    maxWorkspaces: 1,
    maxMembers: 1,
    hasAds: false,
    price: 980,
    label: 'Pro',
  },
  business: {
    maxCustomers: Infinity,
    maxAiCredits: 3000,
    maxWorkspaces: Infinity,
    maxMembers: Infinity, // 実際の上限は seatBlocks × 10
    hasAds: false,
    price: 9800,
    label: 'Business',
  },
};

// =======================================
// Testimonials — LP 掲載候補のフィードバック
// =======================================
// β ユーザーから受け取った感想を保存。allowPublish + status='approved' のものだけ
// LP の「ベータユーザーの声」セクションに SSR で表示される。
// 効果数値（売上 N 倍 等）は載せない、感想ベースのみ（景表法回避）。

export type TestimonialPersona = 'host' | 'cabaret' | 'lounge' | 'staff' | 'other';
export const TESTIMONIAL_PERSONA_LABELS: Record<TestimonialPersona, string> = {
  host: 'ホスト',
  cabaret: 'キャバ嬢',
  lounge: 'ラウンジ嬢',
  staff: '内勤・運営',
  other: 'その他',
};

export type TestimonialContext = 'standalone' | 'ai-thumbs-down';
export type TestimonialStatus = 'pending' | 'approved' | 'rejected';

export interface TestimonialAiContext {
  threadId: string | null;
  messageTs: number | null;
  output: string | null;
  scene: string | null;
  source: string | null;
}

export interface Testimonial {
  id: string;
  uid: string;
  userName: string | null;
  email: string | null;          // 連絡許諾時のみ保存
  quote: string;                 // 本文（生）
  persona: TestimonialPersona;
  yearsOfExperience: number | null;
  locationPref: string | null;   // 都道府県など、自由記述（20 字以内想定）
  allowPublish: boolean;         // LP 掲載許諾
  allowContact: boolean;         // 追加ヒアリング許諾
  context: TestimonialContext;
  aiContext: TestimonialAiContext | null;
  status: TestimonialStatus;
  approvedQuote: string | null;      // 公開用に編集された版（admin が編集）
  approvedPersonaLabel: string | null; // "ホスト 5 年目" 等
  approvedLocation: string | null;
  publishedAt: Timestamp | null;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;     // admin email
  createdAt: Timestamp;
}

/** LP に SSR で配信する公開テストモニアル（最小フィールド） */
export interface PublishedTestimonial {
  id: string;
  quote: string;
  persona: string;
  location: string;
}
