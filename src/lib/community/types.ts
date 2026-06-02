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
  resNo: number;       // レス番号（>>2 以降）
  anonId: string;      // スレ内匿名 ID（表示専用）。自分の投稿は 'あなた'
  postedAt: string;    // 相対表記（モック）。Firestore 移行時は createdAt から算出
  body: string;
  likeCount: number;
  areaTag?: AreaTag;
  jobTag?: JobTag;
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
}

/** スレッド一覧の絞り込み条件 */
export interface ThreadFilter {
  areaTag?: AreaTag | null;
  jobTag?: JobTag | null;
}
