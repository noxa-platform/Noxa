/**
 * 初回案内（メニュー/指名タブレット）→ 席回し卓への反映パッチ（純ロジック・単体テスト対象）。
 *
 * store.ts の submitOrders はトランザクション内で卓の最新値を読み、ここでパッチ
 * （変更フィールドのみ）を作って merge 書きする。旧実装は画面ロード時のキャッシュ
 * (tableDocs) を元に非トランザクションで卓全体像を計算しており、席回し/POS 側の
 * 同時操作を古い値で巻き戻す事故（監査指摘の非Tx問題）があった。
 */

export type FirstVisitTableDoc = {
  status?: string;
  currentHostIds?: string[];
  requestedHostIds?: string[];
  excludedHostIds?: string[];
  assignedHistory?: string[];
  castStartTimes?: Record<string, number>;
};

export type FirstVisitPatch = {
  currentHostIds: string[];
  requestedHostIds: string[];
  excludedHostIds: string[];
  assignedHistory: string[];
  castStartTimes: Record<string, number>;
  status?: 'ACTIVE';
  startTime?: number;
  entryTime?: number;
  type?: string;
};

/**
 * パネルで選ばれたキャスト(selectedIds)を指名(requested)＋現着(current)＋履歴に反映し、
 * 表示パネル(poolIds)のうち選ばれなかったキャストをこの卓の除外に入れる。
 * 選ばれたキャストは除外から外す（前回除外→今回指名の再選択に対応）。
 * 空席卓なら開卓（ACTIVE + 初回タイプ + タイマー開始）。
 */
export function buildFirstVisitPatch(
  tdoc: FirstVisitTableDoc,
  selectedIds: string[],
  poolIds: string[],
  now: number,
): FirstVisitPatch {
  const cur = tdoc.currentHostIds ?? [];
  const req = tdoc.requestedHostIds ?? [];
  const hist = tdoc.assignedHistory ?? [];
  const prevEx = tdoc.excludedHostIds ?? [];
  const starts: Record<string, number> = { ...(tdoc.castStartTimes ?? {}) };

  const nextCur = Array.from(new Set([...cur, ...selectedIds]));
  const nextReq = Array.from(new Set([...req, ...selectedIds]));
  const nextHist = Array.from(new Set([...hist, ...selectedIds]));
  const nextEx = Array.from(new Set([...prevEx, ...poolIds.filter((id) => !selectedIds.includes(id))]))
    .filter((id) => !selectedIds.includes(id));
  for (const id of selectedIds) if (!starts[id]) starts[id] = now;

  const wasEmpty = !tdoc.status || tdoc.status === 'EMPTY';
  return {
    currentHostIds: nextCur,
    requestedHostIds: nextReq,
    excludedHostIds: nextEx,
    assignedHistory: nextHist,
    castStartTimes: starts,
    // 空席卓に指名が入ったら初回として開卓（席回しに ACTIVE で出て残り時間も動く）
    ...(wasEmpty ? { status: 'ACTIVE' as const, startTime: now, entryTime: now, type: '初回' } : {}),
  };
}
