/**
 * 夜職コミュニティ（招待制クローズド × 完全匿名 掲示板）のドメイン型。
 *
 * 仕様の正本: web-knowledge/20_cases/noxa-app-mvp-and-community-launch-2026-05-22.md
 * 将来 Firestore（noxa_* 名前空間）に差し替える前提で、UI から参照する型を
 * バックエンド非依存で定義する。投稿者は完全匿名（内部 ID のみ、表示は「名無しさん」）。
 */

export type AreaTag = '関東' | '関西' | '東海' | '九州' | '北海道' | 'その他';
export type JobTag = 'ホスト' | 'キャバ・ガルバ' | 'ラウンジ・コンカフェ' | '風俗';

/** 板（カテゴリ）。1 ウェッジ MVP では wedge=true の板を主役にする。 */
export interface Board {
  id: string;
  name: string;
  desc: string;
  /** 表示用の活性度（人がいる感）。Firestore 移行時は集計値に置換。 */
  threadCount: number;
  postsToday: number;
  lastActivity: string;
  /** 差別化の一等地（出稼ぎ等） */
  featured?: boolean;
  /** ローンチ初期に開放するウェッジ板か */
  wedge?: boolean;
}

/** レス（1 段フラット） */
export interface Reply {
  id: string;
  resNo: number;          // レス番号（>>2 以降）
  anonId: string;         // 表示用匿名 ID（日替わり・板単位）。内部 uid は出さない
  postedAt: string;       // 相対表記（モック）。Firestore 移行時は createdAt から算出
  body: string;
  likeCount: number;
  areaTag?: AreaTag;
  jobTag?: JobTag;
  isThreadAuthor?: boolean; // スレ主（>>1 と同一投稿者）か。サーバ側で内部 uid 比較し算出
  isMine?: boolean;         // 閲覧者本人の投稿か（本人にのみ true。他人の uid は漏らさない）
  official?: boolean;       // 運営投稿か
}

/** スレッド（>>1 = スレ主の本文を内包） */
export interface Thread {
  id: string;
  boardId: string;
  title: string;
  anonId: string;
  postedAt: string;
  lastActivity: string;
  body: string;        // >>1 本文
  replies: Reply[];    // 詳細表示用。一覧では空配列のことがある（replyCount を参照）
  replyCount?: number; // 一覧用の非正規化レス件数（Firestore: posts.commentCount）
  areaTag?: AreaTag;
  jobTag?: JobTag;
  pinned?: boolean;
  likeCount: number;
  isMine?: boolean;    // 閲覧者本人のスレッドか
  official?: boolean;  // 運営スレッドか
}

/** スレッド一覧の絞り込み条件 */
export interface ThreadFilter {
  areaTag?: AreaTag | null;
  jobTag?: JobTag | null;
}
