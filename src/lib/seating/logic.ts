/**
 * 席回しの純ロジック（Firestore/React 非依存・単体テスト対象）。
 *
 * store.ts は「Firestore から読んだ最新値」をここへ渡してパッチ（変更フィールドのみ）を受け取り、
 * トランザクションで書く。卓ドキュメント全体の上書きは POS 伝票(slips)等を巻き戻すため禁止。
 */
import type { Cast, CastStatus, FloorTable, TableStatus } from './types';

type StoredCastLike = {
  id: string; name: string; rank: Cast['rank']; hourlyWage: number; isLocked: boolean;
  baseStatus: Extract<CastStatus, 'Free' | 'Break' | 'Absent'>; imageUrl?: string; uid?: string | null;
};

/** 卓配置からキャスト稼働状態を導出（配置は卓ドキュメントが正） */
export function computeCasts(stored: StoredCastLike[], tables: FloorTable[]): Cast[] {
  const tableByCast = new Map<string, string>();
  for (const t of tables) for (const cid of t.currentHostIds ?? []) tableByCast.set(cid, t.id);
  return stored.map((s) => ({
    id: s.id, name: s.name, rank: s.rank, hourlyWage: s.hourlyWage, isLocked: s.isLocked,
    imageUrl: s.imageUrl, uid: s.uid ?? null,
    status: (tableByCast.has(s.id) ? 'Work' : s.baseStatus) as CastStatus,
    currentTableId: tableByCast.get(s.id) ?? null,
  }));
}

/** ローテーション: 先頭を末尾へ。2人未満はそのまま */
export function rotateOrder(ids: string[]): string[] {
  if (ids.length < 2) return [...ids];
  const [first, ...rest] = ids;
  return [...rest, first];
}

/**
 * 当日連番。営業日(dayKey)が変わったら 1 から振り直す。
 * meta が無い/旧形式（dayKey 無し）の場合も安全に次番を返す。
 */
export function nextDailySequence(
  meta: { dailySequence?: number; dayKey?: string } | undefined,
  todayKey: string,
): number {
  if (!meta || meta.dayKey !== todayKey) return 1;
  return (meta.dailySequence ?? 0) + 1;
}

/** セット開始できる卓状態か（ACTIVE/CHECK への二重セットで客データを潰さない） */
export function canStartSet(status: TableStatus): boolean {
  return status === 'EMPTY' || status === 'WAITING';
}

export type TablePatch = Partial<FloorTable>;

/** キャストを卓から外すパッチ（対象卓の配列/開始時刻のみ変更） */
export function removeCastPatch(t: FloorTable, castId: string): TablePatch {
  const castStartTimes = { ...(t.castStartTimes ?? {}) };
  delete castStartTimes[castId];
  return {
    currentHostIds: (t.currentHostIds ?? []).filter((c) => c !== castId),
    mainHostIds: (t.mainHostIds ?? []).filter((c) => c !== castId),
    castStartTimes,
  };
}

/**
 * キャスト配置パッチ群。
 * 不変条件: 1 キャストは同時に 1 卓のみ（他卓からは引き剥がす）。
 * 返り値は「変更が必要な卓のみ」の {tableId, patch} 配列。
 */
export function buildAssignPatches(
  tables: FloorTable[],
  tableId: string,
  castId: string,
  now: number,
): { tableId: string; patch: TablePatch }[] {
  const patches: { tableId: string; patch: TablePatch }[] = [];
  for (const t of tables) {
    const has = (t.currentHostIds ?? []).includes(castId);
    if (t.id === tableId) {
      if (has) continue; // 既に着席済み＝変更なし
      const castStartTimes = { ...(t.castStartTimes ?? {}), [castId]: now };
      const assignedHistory = (t.assignedHistory ?? []).includes(castId)
        ? t.assignedHistory
        : [...(t.assignedHistory ?? []), castId];
      patches.push({
        tableId: t.id,
        patch: { currentHostIds: [...(t.currentHostIds ?? []), castId], castStartTimes, assignedHistory },
      });
    } else if (has) {
      patches.push({ tableId: t.id, patch: removeCastPatch(t, castId) });
    }
  }
  return patches;
}

/** 配列トグル（mainHostIds / requestedHostIds 用） */
export function toggleInArray(arr: string[] | undefined, id: string): string[] {
  const a = arr ?? [];
  return a.includes(id) ? a.filter((x) => x !== id) : [...a, id];
}

/**
 * セット残り時間の計算（純関数）。
 * 延長(extraMinutes)は「セット長(setTimeLength)を変えずに」現在の来店の境界を後ろへずらす。
 * 旧実装は延長で setTimeLength 本体を加算しており、以降の全セットが恒久的に
 * 伸びて料金・セット数がずれるバグだった（BUG-3）。
 */
export type SetTimerInfo = { remainingMin: number; setNumber: number; setLen: number; warning: boolean; progress: number };

export function computeSetTimer(
  t: Pick<FloorTable, 'status' | 'startTime' | 'setTimeLength' | 'extraMinutes'>,
  nowMs: number,
): SetTimerInfo | null {
  if (t.status !== 'ACTIVE' || !t.startTime || !t.setTimeLength) return null;
  const len = t.setTimeLength;
  const extra = Math.max(0, t.extraMinutes ?? 0);
  const elapsed = Math.floor((nowMs - t.startTime) / 60000);
  // 延長分だけ経過を差し引く＝境界が extra 分だけ後ろへずれる（セット長は不変）
  const effective = Math.max(0, elapsed - extra);
  const setNumber = Math.floor(effective / len) + 1;
  const remainingMin = Math.max(0, setNumber * len + extra - elapsed);
  const progress = Math.min(1, (len - Math.min(remainingMin, len)) / len);
  return { remainingMin, setNumber, setLen: len, warning: remainingMin <= 10, progress };
}

/**
 * キャストを全卓から除去するパッチ群（名簿削除時の幽霊配置防止・BUG-7）。
 * 変更が必要な卓のみ返す。
 */
export function stripCastPatches(tables: FloorTable[], castId: string): { tableId: string; patch: TablePatch }[] {
  const patches: { tableId: string; patch: TablePatch }[] = [];
  for (const t of tables) {
    const inCurrent = (t.currentHostIds ?? []).includes(castId);
    const inMain = (t.mainHostIds ?? []).includes(castId);
    const inReq = (t.requestedHostIds ?? []).includes(castId);
    const inEx = (t.excludedHostIds ?? []).includes(castId);
    if (!inCurrent && !inMain && !inReq && !inEx) continue;
    const castStartTimes = { ...(t.castStartTimes ?? {}) };
    delete castStartTimes[castId];
    patches.push({
      tableId: t.id,
      patch: {
        currentHostIds: (t.currentHostIds ?? []).filter((c) => c !== castId),
        mainHostIds: (t.mainHostIds ?? []).filter((c) => c !== castId),
        requestedHostIds: (t.requestedHostIds ?? []).filter((c) => c !== castId),
        excludedHostIds: (t.excludedHostIds ?? []).filter((c) => c !== castId),
        castStartTimes,
      },
    });
  }
  return patches;
}
