// ミッション定義（クライアント / サーバー共用）。
//
// 「データを入力する導線」「紹介で使わせる導線」の 2 軸に絞っており、
// AI 機能の利用はクレジット配布対象から意図的に外している（自家撞着を避けるため）。
//
// 受領管理: reward_missions/{uid}.claimed: { [missionId]: ServerTimestamp }
// 受領は冪等（既に claimed なら何もしない）。

/**
 * ミッションの分類。
 *
 * ✅ **値を足しても iOS は落ちない**（2026-08-30・yorulog が現物の行で実測）。
 * `MissionService.swift:19-50` の `MissionCategory` は**独自の `init(from:)`** を持ち、
 * 未知の値は `.unknown(raw)` になって **throw しない**（`rawValue` も潰さない）。
 * 実測テスト `ForwardCompatEnumsP131Tests.testUnknownCategoryDoesNotDropTheWholeMissionList`
 * が、実際の入れ子で未知の値を混ぜても**一覧が全件残る**ことを固定している。
 * ⚠️ **この前方互換は iOS の P131 で入ったもの**で、それ以前は非 optional だった。
 * 外す・厳しくするときは向こうから連絡が来る（`MissionCategory` の docstring に記載済み）。
 *
 * 🔴 **落ちる引き金は `category` ではない。** `MissionItem` の他 6 フィールド
 * （`id` / `title` / `description` / `rewardCredits` / `order` / `claimed`）が**非 optional**で、
 * **欠けるか型が変わると一覧ごと throw する**。締める対象はそちら
 * （`test/lib/missions.test.ts` の「/api/missions の応答の必須 6 キー」）。
 */
export type MissionCategory = 'profile' | 'data' | 'referral';

export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  category: MissionCategory;
  rewardCredits: number;
  /** 表示順 */
  order: number;
}

export const MISSIONS: readonly MissionDefinition[] = [
  {
    id: 'profile_complete',
    title: 'プロフィールを全部埋める',
    description: '源氏名・役職・性別・一人称・トーン・絵文字頻度を入力',
    category: 'profile',
    rewardCredits: 10,
    order: 10,
  },
  {
    id: 'first_customer',
    title: '顧客を 1 人追加する',
    description: '最初の顧客を登録',
    category: 'data',
    rewardCredits: 5,
    order: 20,
  },
  {
    id: 'first_log',
    title: '接触ログを 1 件つける',
    description: '来店・同伴・電話などのログを残す',
    category: 'data',
    rewardCredits: 5,
    order: 30,
  },
  {
    id: 'add_5_customers',
    title: '顧客 5 人を達成',
    description: '顧客台帳に 5 人登録',
    category: 'data',
    rewardCredits: 5,
    order: 40,
  },
  {
    id: 'accept_referral',
    title: '紹介コードを使って登録',
    description: '友達の紹介コードを入力すると獲得',
    category: 'referral',
    rewardCredits: 20,
    order: 50,
  },
  {
    id: 'share_referral',
    title: '紹介コードをシェア',
    description: 'コピーまたは共有ボタンを 1 度押す',
    category: 'referral',
    rewardCredits: 5,
    order: 60,
  },
  {
    id: 'invite_first_friend',
    title: '友達を 1 人 Noxa に招待',
    description: '紹介コード経由で 1 人が登録すると獲得',
    category: 'referral',
    rewardCredits: 50,
    order: 70,
  },
] as const;

export type MissionId = (typeof MISSIONS)[number]['id'];

export function getMission(id: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** 全ミッションを完走したときの最大クレジット獲得量 */
export function totalRewardCredits(): number {
  return MISSIONS.reduce((acc, m) => acc + m.rewardCredits, 0);
}

/** ミッション ID リスト（型安全な enum 風） */
export const MISSION_IDS = MISSIONS.map((m) => m.id) as readonly MissionId[];

/** referral 系の報酬定数（直接呼び出されることがある） */
export const REFERRAL_BONUS = {
  referrer: 50, // 招待者: invite_first_friend と同額
  referee: 20,  // 被招待者: accept_referral と同額
} as const;
