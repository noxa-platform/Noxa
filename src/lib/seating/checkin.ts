/**
 * 予約「来店済」→ 開卓＋POS初期伝票の生成（純ロジック・Day8: 予約→来店→会計の一気通貫）。
 *
 * ReservationClient がトランザクション内で卓・連番を読み、この関数のペイロードを
 * tx.update で書く（トップレベル置換＝マップ ghost を残さない）。
 * 予約の指名キャストは本指名(mainHostIds)として卓に付け、伝票の担当にも載せる
 * （会計時にそのまま personal_sales の帰属先になる）。
 */
import type { Customer, FloorTable } from './types';
import { pruneCastStartTimes } from './logic';
import type { CalculatorState, PosSlip } from '@/lib/pos/engine';

export type CheckinCast = { id: string; name: string; uid?: string | null };

export type CheckinInput = {
  table: FloorTable;
  /** 当日連番（nextDailySequence の結果） */
  seq: number;
  now: number;
  guests: number;
  customerName: string;
  /** 予約の指名キャスト（名簿解決済み。未指定/未解決なら null） */
  cast: CheckinCast | null;
  slipId: string;
  /** POS 設定から作った初期伝票 state（createInitialState） */
  slipState: CalculatorState;
};

const uniq = (arr: string[]) => Array.from(new Set(arr));

/** 開卓＋初期伝票の卓更新ペイロード（Firestore が拒否する undefined は含めない） */
export function buildReservationCheckin(i: CheckinInput): Record<string, unknown> {
  const guests = Math.max(1, Math.floor(i.guests) || 1);
  const name = i.customerName.trim();
  const customers: Customer[] = Array.from({ length: guests }, (_, k) => ({
    id: `cust_${i.now}_${k}`,
    // undefined を書くと Firestore が invalid-argument になるため、名前は先頭客のみキー自体を付与
    ...(k === 0 && name ? { name } : {}),
    type: '正規' as const,
    entryTime: i.now,
  }));

  const slip: PosSlip = {
    id: i.slipId,
    name: name || '①',
    state: i.slipState,
    ...(i.cast ? { castName: i.cast.name, castId: i.cast.id } : {}),
    ...(i.cast?.uid ? { castUid: i.cast.uid } : {}),
    ...(name ? { customerName: name } : {}),
  };

  // 新しい来店＝着席時刻は現在着席中のみ引き継ぎ（ghost 一掃）＋指名キャストを追加
  const castStartTimes = pruneCastStartTimes(i.table.castStartTimes, i.table.currentHostIds);
  if (i.cast && !castStartTimes[i.cast.id]) castStartTimes[i.cast.id] = i.now;

  return {
    status: 'ACTIVE',
    startTime: i.now,
    entryTime: i.now,
    entryNumber: i.seq,
    type: '正規',
    customers,
    ...(i.cast
      ? {
          currentHostIds: uniq([...(i.table.currentHostIds ?? []), i.cast.id]),
          mainHostIds: uniq([...(i.table.mainHostIds ?? []), i.cast.id]), // 予約指名＝本指名
          requestedHostIds: uniq([...(i.table.requestedHostIds ?? []), i.cast.id]),
          assignedHistory: uniq([...(i.table.assignedHistory ?? []), i.cast.id]),
        }
      : {}),
    castStartTimes,
    extraMinutes: 0,
    sessionLog: [], // 回し履歴は来店単位
    slips: [...(i.table.slips ?? []), slip],
  };
}
