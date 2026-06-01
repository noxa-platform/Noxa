/**
 * 席回し AI マネージャ（純ロジック）。
 * night_manager の features/ai-manager から移植・整理。
 * - sourcing: 配置候補の優先度付け（S 指名 / A 待機 / B ヘルプ引き剥がし）
 * - pairing : 初回卓向けベストペア探索（ランク相性スコア）
 * - rotation: 席内ローテ提案
 * - generator: 全卓を見て提案リストを生成
 */
import type { Cast, FloorTable } from './types';

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
  const validCasts = allCasts.filter((c) => c.rank !== 'BOSS' && !c.isLocked);
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

export function findBestPairWithScore(candidates: SourcingCandidate[]): PairResult | null {
  if (candidates.length < 2) return null;

  let bestPair: PairResult | null = null;
  let maxScore = -Infinity;

  const isOfficer = (r: string) => r === '役職';
  const isRegular = (r: string) => r === '非役職';
  const isRookie = (r: string) => r === '新人';
  const getPrioScore = (p: string) => (p === 'S' ? 50 : p === 'A' ? 10 : 0);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const c1 = candidates[i];
      const c2 = candidates[j];
      const r1 = c1.cast.rank;
      const r2 = c2.cast.rank;

      let baseScore = 0;
      let type: PairResult['type'] = 'Acceptable';

      if ((isOfficer(r1) && isRookie(r2)) || (isOfficer(r2) && isRookie(r1))) { baseScore = 100; type = 'Excellent'; }
      else if ((isOfficer(r1) && isRegular(r2)) || (isOfficer(r2) && isRegular(r1))) { baseScore = 85; type = 'Good'; }
      else if (isRegular(r1) && isRegular(r2)) { baseScore = 80; type = 'Good'; }
      else if ((isRegular(r1) && isRookie(r2)) || (isRegular(r2) && isRookie(r1))) { baseScore = 60; type = 'Acceptable'; }
      else if (isRookie(r1) && isRookie(r2)) { baseScore = -999; type = 'Avoid'; }
      else { baseScore = 80; type = 'Good'; }

      const totalScore = baseScore + getPrioScore(c1.priority) + getPrioScore(c2.priority);
      if (totalScore > maxScore) {
        maxScore = totalScore;
        bestPair = { cast1: c1.cast, cast2: c2.cast, score: totalScore, type };
      }
    }
  }
  return bestPair;
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
        !proposedCastIds.has(c.cast.id) && !table.assignedHistory?.includes(c.cast.id));

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
    }
  }

  return proposals.sort((a, b) => b.score - a.score);
}
