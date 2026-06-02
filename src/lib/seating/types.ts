/**
 * 席回し（フロア管理）の型定義。
 * night_manager（zustand/localStorage 版）から移植し、NOXA では shop ごとに
 * Firestore（shop_shops/{shopId}/seating_*）へ保存する。
 */

import type { PosSlip } from '@/lib/pos/engine';

export type Rank = 'BOSS' | '役職' | '非役職' | '新人';

export type CastStatus = 'Free' | 'Work' | 'Break' | 'Absent';

export interface Cast {
  id: string;
  name: string;
  rank: Rank;
  hourlyWage: number;
  status: CastStatus;
  isLocked: boolean;
  currentTableId?: string | null;
  imageUrl?: string;
  uid?: string | null; // 紐付くアカウント uid（個人売上の帰属用・未連携なら null）
}

export type TableType = '初回' | '初回指名' | 'R' | '正規';
export type TableStatus = 'EMPTY' | 'ACTIVE' | 'CHECK' | 'WAITING';

export interface Customer {
  id: string;
  name?: string;
  type: TableType;
  entryTime: number;
  age?: string;
  notes?: string;
}

export interface FloorTable {
  id: string;
  name: string;
  type: TableType;
  status: TableStatus;
  customers: Customer[];

  // キャスト配置
  mainHostIds: string[];      // 本指名（複数可）
  currentHostIds: string[];   // 現在着席中
  requestedHostIds: string[]; // 指名待ち
  assignedHistory: string[];  // この卓に着いた履歴（重複配置回避）
  castStartTimes: Record<string, number>; // castId -> 着席時刻

  // 時刻
  startTime: number | null;
  entryTime: number | null;
  entryNumber?: number;

  // 設定
  setTimeLength: number;       // 1セット長（分）
  rotationTimeLength: number;  // 席内ローテ間隔（分）
  innerRotationEnabled: boolean;
  memo?: string;

  // POS 伝票（席回しと同一卓ドキュメントを共有＝完全同期）
  slips?: PosSlip[];
}

export interface QueueItem {
  id: string;
  name: string;
  groupSize: number;
  type: TableType;
  joinedAt: number;
  notes?: string;
}

export function createEmptyTable(id: string, name: string): FloorTable {
  return {
    id,
    name,
    type: '正規',
    status: 'EMPTY',
    customers: [],
    mainHostIds: [],
    currentHostIds: [],
    requestedHostIds: [],
    assignedHistory: [],
    castStartTimes: {},
    startTime: null,
    entryTime: null,
    setTimeLength: 60,
    rotationTimeLength: 15,
    innerRotationEnabled: false,
    memo: '',
  };
}
