/**
 * 席回し AI マネージャ（純ロジック）。
 * night_manager の features/ai-manager から移植・整理。
 * - sourcing: 配置候補の優先度付け（S 指名 / A 待機 / B ヘルプ引き剥がし）
 * - pairing : 初回卓向けベストペア探索（ランク相性スコア）
 * - rotation: 席内ローテ提案
 * - generator: 全卓を見て提案リストを生成
 */
import type { Cast, FloorTable } from './types';
import { orderedRotationQueue } from './logic';

export type ProposalType = 'ASSIGN' | 'ROTATION' | 'MOVE' | 'HELP';

export interface AIProposal {
  id: string;
  type: ProposalType;
  message: string;
  reason?: string;
  targetTableId?: string;
  castId?: string;
  castIds?: string[];
  sourceTableId?: string;
  score: number;
}

// ───────────────────────── sourcing

export interface SourcingCandidate {
  cast: Cast;
  priority: 'S' | 'A' | 'B';
  sourceTableId?: string;
}

export function getSourcingCandidates(
  allCasts: Cast[],
  allTables: FloorTable[],
  targetTable?: FloorTable,
): SourcingCandidate[] {
  const results: SourcingCandidate[] = [];
  const excluded = new Set(targetTable?.excludedHostIds ?? []);
  const validCasts = allCasts.filter((c) => c.rank !== 'BOSS' && !c.isLocked && !excluded.has(c.id));
  const isMainOnAnyTable = (castId: string) => allTables.some((t) => t.mainHostIds?.includes(castId));

  for (const cast of validCasts) {
    // Priority S: 指名
    if (targetTable?.requestedHostIds?.includes(cast.id)) {
      if (cast.status === 'Free') { results.push({ cast, priority: 'S' }); continue; }
      if (cast.status === 'Work' && !isMainOnAnyTable(cast.id)) {
        const currentTable = allTables.find((t) => t.currentHostIds.includes(cast.id));
        results.push({ cast, priority: 'S', sourceTableId: currentTable?.id });
        continue;
      }
    }
    // Priority A: 待機
    if (cast.status === 'Free') { results.push({ cast, priority: 'A' }); continue; }
    // Priority B: ヘルプ引き剥がし（本指名でない着席中のみ）
    if (cast.status === 'Work') {
      const currentTable = allTables.find((t) => t.currentHostIds.includes(cast.id));
      if (currentTable && !currentTable.mainHostIds?.includes(cast.id)) {
        results.push({ cast, priority: 'B', sourceTableId: currentTable.id });
      }
    }
  }

  const priorityScore = { S: 3, A: 2, B: 1 } as const;
  return results.sort((a, b) => priorityScore[b.priority] - priorityScore[a.priority]);
}

// ───────────────────────── pairing

export interface PairResult {
  cast1: Cast;
  cast2: Cast;
  score: number;
  type: 'Excellent' | 'Good' | 'Acceptable' | 'Avoid';
}

/** ランク相性の基礎スコア（役職×新人=育成ペアが最良、新人×新人は回避） */
export function rankPairScore(r1: string, r2: string): { base: number; type: PairResult['type'] } {
  const isOfficer = (r: string) => r === '役職';
  const isRegular = (r: string) => r === '非役職';
  const isRookie = (r: string) => r === '新人';
  if ((isOfficer(r1) && isRookie(r2)) || (isOfficer(r2) && isRookie(r1))) return { base: 100, type: 'Excellent' };
  if ((isOfficer(r1) && isRegular(r2)) || (isOfficer(r2) && isRegular(r1))) return { base: 85, type: 'Good' };
  if (isRegular(r1) && isRegular(r2)) return { base: 80, type: 'Good' };
  if ((isRegular(r1) && isRookie(r2)) || (isRegular(r2) && isRookie(r1))) return { base: 60, type: 'Acceptable' };
  if (isRookie(r1) && isRookie(r2)) return { base: -999, type: 'Avoid' };
  return { base: 80, type: 'Good' };
}

export function findBestPairWithScore(candidates: SourcingCandidate[]): PairResult | null {
  if (candidates.length < 2) return null;

  let bestPair: PairResult | null = null;
  let maxScore = -Infinity;

  const getPrioScore = (p: string) => (p === 'S' ? 50 : p === 'A' ? 10 : 0);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const c1 = candidates[i];
      const c2 = candidates[j];
      const { base: baseScore, type } = rankPairScore(c1.cast.rank, c2.cast.rank);
      const totalScore = baseScore + getPrioScore(c1.priority) + getPrioScore(c2.priority);
      if (totalScore > maxScore) {
        maxScore = totalScore;
        bestPair = { cast1: c1.cast, cast2: c2.cast, score: totalScore, type };
      }
    }
  }
  return bestPair;
}

// ───────────────────────── smart engine（計算ベースの采配・LLM 不使用）

/** 采配モード（店舗で切替・seating_meta/state.assistMode に保存） */
export type AssistMode = 'balanced' | 'nomination' | 'rookie';

export const ASSIST_MODE_LABEL: Record<AssistMode, string> = {
  balanced: 'バランス', nomination: '指名優先', rookie: '新人育成',
};

/** NG 組合せ（どちらか一方の ngCastIds に入っていれば NG＝対称扱い） */
export function isNgPair(a: Pick<Cast, 'id' | 'ngCastIds'>, b: Pick<Cast, 'id' | 'ngCastIds'>): boolean {
  return (a.ngCastIds ?? []).includes(b.id) || (b.ngCastIds ?? []).includes(a.id);
}

type ScoredCandidate = { cast: Cast; tier: 'S' | 'A' | 'B'; score: number; reasons: string[] };

/**
 * 計算ベースの席回し采配エンジン（決定的・無料・LLM 不使用）。
 * generateAIProposals の後継。スコアリング割当で提案を作る:
 *   - 指名/PU（S）を最優先（nomination モードではさらに強く）
 *   - 回す順番キュー（rotationOrder）の先頭ほど優先（balanced モードで重く）＝公平性
 *   - ランク相性（役職×新人=育成ペア、新人×新人は回避）
 *   - NG 組合せ・ロック・除外・BOSS・他卓の本指名はハード制約（絶対に提案しない）
 * 理由(reason)に採用根拠を列挙し、UI の理由つきカードにそのまま出す。
 */
export function generateSmartProposals(
  allTables: FloorTable[],
  allCasts: Cast[],
  opts: { rotationOrder?: string[]; mode?: AssistMode } = {},
): AIProposal[] {
  const mode = opts.mode ?? 'balanced';
  const proposals: AIProposal[] = [];
  const used = new Set<string>();

  // 回す順番（公平性の根拠）。先頭=次に付くべき人
  const queue = orderedRotationQueue(opts.rotationOrder, allCasts);
  const queueIdx = new Map(queue.map((c, i) => [c.id, i]));
  const queueWeight = mode === 'balanced' ? 30 : 10;

  const isMainOnAnyTable = (castId: string) => allTables.some((t) => t.mainHostIds?.includes(castId));

  // A. 席内ローテ提案（従来どおり）
  for (const table of allTables) {
    const r = proposeRotation(table);
    if (r) proposals.push(r);
  }

  // B. 人が足りない卓を必要数の多い順に処理（初回2名 > 配置ゼロ卓1名）
  const needTables = allTables
    .filter((t) => t.status === 'ACTIVE')
    .map((t) => ({
      t,
      need: t.type === '初回' && t.customers.length >= 2 && t.currentHostIds.length < 2
        ? 2 - t.currentHostIds.length
        : t.currentHostIds.length === 0 ? 1 : 0,
    }))
    .filter((x) => x.need > 0)
    .sort((a, b) => b.need - a.need || (b.t.requestedHostIds?.length ?? 0) - (a.t.requestedHostIds?.length ?? 0));

  for (const { t: table, need } of needTables) {
    const currentCasts = (table.currentHostIds ?? [])
      .map((id) => allCasts.find((c) => c.id === id))
      .filter((c): c is Cast => !!c);

    const cands: ScoredCandidate[] = [];
    for (const cast of allCasts) {
      if (used.has(cast.id)) continue;
      // ハード制約
      if (cast.rank === 'BOSS' || cast.isLocked) continue;
      if (table.excludedHostIds?.includes(cast.id)) continue;
      if ((table.currentHostIds ?? []).includes(cast.id)) continue;
      if (table.assignedHistory?.includes(cast.id)) continue; // 同卓への再配置回避（従来仕様）
      if (currentCasts.some((h) => isNgPair(cast, h))) continue; // NG 組合せ

      // 供給ティア: S=指名/PU・A=待機・B=他卓ヘルプ引き剥がし（本指名は不可）
      const requested = table.requestedHostIds?.includes(cast.id) ?? false;
      let tier: ScoredCandidate['tier'];
      if (requested && (cast.status === 'Free' || (cast.status === 'Work' && !isMainOnAnyTable(cast.id)))) tier = 'S';
      else if (cast.status === 'Free') tier = 'A';
      else if (cast.status === 'Work' && !isMainOnAnyTable(cast.id)) tier = 'B';
      else continue;

      let score = tier === 'S' ? (mode === 'nomination' ? 2000 : 1000) : tier === 'A' ? 200 : 40;
      const reasons: string[] = [];
      if (tier === 'S') reasons.push('指名/PU');
      if (tier === 'B') reasons.push('他卓からヘルプ');

      const qi = queueIdx.get(cast.id);
      if (qi !== undefined) {
        score += Math.max(0, queue.length - qi) * queueWeight;
        reasons.push(`回す順${qi + 1}番`);
      }
      // 既に付いている面子との相性（半分の重み）
      for (const host of currentCasts) score += rankPairScore(cast.rank, host.rank).base / 2;
      if (mode === 'rookie' && cast.rank === '新人' && currentCasts.some((h) => h.rank === '役職')) {
        score += 150; reasons.push('役職の下で育成');
      }
      cands.push({ cast, tier, score, reasons });
    }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length === 0) continue;

    if (need >= 2 && cands.length >= 2) {
      // ペア選定: 上位候補同士の総当たりで 相性+個別スコア が最大の組（NG ペアは除外）
      const top = cands.slice(0, 8);
      let best: { a: ScoredCandidate; b: ScoredCandidate; score: number; type: PairResult['type'] } | null = null;
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) {
          const a = top[i]; const b = top[j];
          if (isNgPair(a.cast, b.cast)) continue;
          const pair = rankPairScore(a.cast.rank, b.cast.rank);
          let s = a.score + b.score + pair.base;
          if (mode === 'rookie' && pair.type === 'Excellent') s += 200; // 役職×新人を積極採用
          if (!best || s > best.score) best = { a, b, score: s, type: pair.type };
        }
      }
      if (best) {
        const prefix = best.type === 'Avoid' ? '⚠️[注意]' : best.type === 'Excellent' ? '✨[推奨]' : '[提案]';
        const reasons = [...new Set([...best.a.reasons, ...best.b.reasons])];
        if (best.type === 'Excellent') reasons.push('育成ペア(役職×新人)');
        proposals.push({
          id: `pair-${table.id}`, type: 'ASSIGN',
          message: `${prefix} ${table.name} に ${best.a.cast.name} と ${best.b.cast.name}`,
          targetTableId: table.id, castIds: [best.a.cast.id, best.b.cast.id],
          score: best.score, reason: reasons.join('・'),
        });
        used.add(best.a.cast.id); used.add(best.b.cast.id);
        continue;
      }
    }
    // シングル補充
    const bestOne = cands[0];
    const prefix = bestOne.tier === 'S' ? '🔥[指名]' : '[補充]';
    proposals.push({
      id: `fill-${table.id}`, type: 'ASSIGN',
      message: `${prefix} ${table.name} に ${bestOne.cast.name}`,
      targetTableId: table.id, castId: bestOne.cast.id, castIds: [bestOne.cast.id],
      score: bestOne.score, reason: bestOne.reasons.join('・') || 'ヘルプ補充',
    });
    used.add(bestOne.cast.id);
  }

  return proposals.sort((a, b) => b.score - a.score);
}

// ───────────────────────── rotation

export function proposeRotation(table: FloorTable): AIProposal | null {
  if (!table.innerRotationEnabled) return null;
  if (table.currentHostIds.length < 2) return null;
  if (table.status !== 'ACTIVE') return null;
  return {
    id: `rot-${table.id}`,
    type: 'ROTATION',
    message: `[席内ローテ] ${table.name} でキャストを入れ替えますか？`,
    targetTableId: table.id,
    score: 50,
  };
}

// ───────────────────────── AI（サーバ提案）のバリデーション

export interface AiPlanItem {
  tableId: string;
  action: 'assign' | 'rotate';
  castIds: string[];
  reason: string;
}

/**
 * /api/ai/seating-suggest の応答を盤面の制約で検証する（純ロジック）。
 * AI の柔軟解釈 × 純ロジックの制約充足のハイブリッド構成の「制約」側。
 * - 存在しない卓/キャスト・不正 action を落とす
 * - BOSS / ロック中 / 欠勤 / その卓の除外リスト入りは配置しない
 * - 他卓で本指名(main)のキャストは引き剥がさない
 * - 既にその卓に居るキャストは再配置しない
 * - rotate は現着2人以上の卓のみ
 */
export function sanitizeAiPlan(raw: unknown, casts: Cast[], tables: FloorTable[]): AiPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const castById = new Map(casts.map((c) => [c.id, c]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const isMainElsewhere = (castId: string, tableId: string) =>
    tables.some((t) => t.id !== tableId && (t.mainHostIds ?? []).includes(castId));

  const out: AiPlanItem[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue;
    const tableId = typeof item.tableId === 'string' ? item.tableId : '';
    const action = item.action === 'assign' || item.action === 'rotate' ? item.action : null;
    const table = tableById.get(tableId);
    if (!table || !action) continue;
    const reason = typeof item.reason === 'string' ? item.reason.slice(0, 120) : '';

    if (action === 'rotate') {
      if ((table.currentHostIds ?? []).length < 2) continue;
      out.push({ tableId, action, castIds: [], reason });
    } else {
      const excluded = new Set(table.excludedHostIds ?? []);
      const currentCasts = (table.currentHostIds ?? []).map((id) => castById.get(id)).filter((c): c is Cast => !!c);
      const picked: Cast[] = [];
      const ids = (Array.isArray(item.castIds) ? item.castIds : [])
        .filter((id): id is string => typeof id === 'string')
        .filter((id) => {
          const c = castById.get(id);
          if (!c) return false;
          if (c.rank === 'BOSS' || c.isLocked || c.status === 'Absent') return false;
          if (excluded.has(id)) return false;
          if ((table.currentHostIds ?? []).includes(id)) return false;
          if (isMainElsewhere(id, tableId)) return false;
          // NG 組合せ: 既に卓に居る面子とも、同じ提案内で先に採用した面子とも組ませない
          if ([...currentCasts, ...picked].some((h) => isNgPair(c, h))) return false;
          picked.push(c);
          return true;
        });
      if (ids.length === 0) continue;
      out.push({ tableId, action, castIds: ids, reason });
    }
    if (out.length >= 5) break;
  }
  return out;
}

// ───────────────────────── generator

export function generateAIProposals(allTables: FloorTable[], allCasts: Cast[]): AIProposal[] {
  const proposals: AIProposal[] = [];
  const proposedCastIds = new Set<string>();

  for (const table of allTables) {
    if (table.status !== 'ACTIVE') continue;

    // A. 席内ローテ
    const rotationProposal = proposeRotation(table);
    if (rotationProposal) proposals.push(rotationProposal);

    // B. 初回卓のペアリング（2名以上 かつ キャスト不足）
    if (table.type === '初回' && table.customers.length >= 2 && table.currentHostIds.length < 2) {
      const candidates = getSourcingCandidates(allCasts, allTables, table).filter((c) =>
        !proposedCastIds.has(c.cast.id) && !table.assignedHistory?.includes(c.cast.id) && !table.excludedHostIds?.includes(c.cast.id));

      const pairResult = findBestPairWithScore(candidates);
      if (pairResult) {
        const { cast1, cast2, score, type } = pairResult;
        const prefix = type === 'Avoid' ? '⚠️[注意]' : type === 'Excellent' ? '✨[推奨]' : '[提案]';
        proposals.push({
          id: `pair-${table.id}`,
          type: 'ASSIGN',
          message: `${prefix} ${table.name} に ${cast1.name} と ${cast2.name}（${type}）`,
          targetTableId: table.id,
          castIds: [cast1.id, cast2.id],
          score,
          reason: `Rank: ${cast1.rank}+${cast2.rank}`,
        });
        proposedCastIds.add(cast1.id);
        proposedCastIds.add(cast2.id);
      } else if (candidates.length > 0) {
        const best = candidates[0];
        const prefix = best.priority === 'S' ? '🔥[指名]' : '[補充]';
        proposals.push({
          id: `single-${table.id}`,
          type: 'ASSIGN',
          message: `${prefix} ${table.name} に ${best.cast.name}（シングル）`,
          targetTableId: table.id,
          castId: best.cast.id,
          castIds: [best.cast.id],
          score: best.priority === 'S' ? 90 : 40,
          reason: `Priority: ${best.priority}`,
        });
        proposedCastIds.add(best.cast.id);
      }
    } else if (table.currentHostIds.length === 0) {
      // C. 配置なしのACTIVE卓（type不問）に補充提案
      const candidates = getSourcingCandidates(allCasts, allTables, table).filter((c) =>
        !proposedCastIds.has(c.cast.id) && !table.assignedHistory?.includes(c.cast.id) && !table.excludedHostIds?.includes(c.cast.id));
      if (candidates.length > 0) {
        const best = candidates[0];
        const prefix = best.priority === 'S' ? '🔥[指名]' : '[補充]';
        proposals.push({
          id: `fill-${table.id}`,
          type: 'ASSIGN',
          message: `${prefix} ${table.name}（配置なし）に ${best.cast.name}`,
          targetTableId: table.id,
          castId: best.cast.id,
          castIds: [best.cast.id],
          score: best.priority === 'S' ? 88 : 35,
          reason: `Priority: ${best.priority}`,
        });
        proposedCastIds.add(best.cast.id);
      }
    }
  }

  return proposals.sort((a, b) => b.score - a.score);
}
