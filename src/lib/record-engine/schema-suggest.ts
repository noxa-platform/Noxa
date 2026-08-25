// 記録エンジン Phase 0: 「いま既に可変な 3 項目」を AI が店に合わせて提案する（P148）。
//
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md`。段 5（`record_schema` + `x` マップ）へ
// 進む前の足がかりで、**スキーマも rules も一切変えない**。器（`customTags` /
// `customVisitTypes` / `optionalGoals`）は既にあるので、提案を返すだけで
// 「AI がうちの店に合わせてくれる」体験が出る。
//
// ここは**検証だけ**を持つ純関数。route は入出力と課金に専念する。
//
// ## 設計の芯（外すと事故になる）
//
// 1. **追加提案のみ**。既存の改名・削除・並べ替えは扱わない。Phase 0 を「足すだけ」に
//    閉じておくと、**取り消しが「足したものを消す」だけで済む**。改名や削除を混ぜた瞬間に
//    「元に戻す」ためには変更前の版が要り、段 7（AI によるルール生成）の設計待ちになる。
// 2. **既存と重複しないもののみ**。重複判定は表記ゆれを潰してから行う——
//    「常連」と「常　連」と「常連 」が別物として増えると、集計が割れて目標が壊れる。
// 3. **`reason` が無い提案は捨てる**。理由の無い候補はユーザーが選べず、
//    「よく分からないまま全部チェックして適用」に倒れる。それは提案ではなく勝手な変更。
// 4. **`monthlyTarget` は分からなければ省略**。0 を返すと「目標ゼロ」という意味になり、
//    達成率の分母が 0 になる。欠落と 0 を区別する。
import type { OptionalGoalUnit } from '@/lib/types';

/** iOS の `OptionalGoalUnit` と一致させる。**勝手に増やさない**（iOS がデコード時に落とす） */
export const SUGGEST_UNITS: readonly OptionalGoalUnit[] = ['toggle', 'count', 'amount', 'countAndAmount'];

/** 1 カテゴリあたりの上限。多すぎる候補は選ぶ気を失わせ、結局全部チェックされる */
export const MAX_PER_CATEGORY = 10;
/** 項目名の上限。画面に収まらない名前は集計の凡例も壊す */
export const MAX_NAME_LENGTH = 24;
/** 理由は日本語 1 行。長文は読まれないうえ、プロンプト注入の運び先になる */
export const MAX_REASON_LENGTH = 60;
/** 月次目標の上限。桁を間違えた提案が「達成不可能な目標」として保存されるのを防ぐ */
export const MAX_MONTHLY_TARGET = 1_000_000;

export interface SuggestedName {
  name: string;
  reason: string;
}

export interface SuggestedGoal extends SuggestedName {
  unit: OptionalGoalUnit;
  /** 読み取れなかったら**省略**する（0 を入れない） */
  monthlyTarget?: number;
}

export interface SchemaSuggestion {
  customTags: SuggestedName[];
  customVisitTypes: SuggestedName[];
  optionalGoals: SuggestedGoal[];
}

export interface ExistingSchema {
  customTags?: unknown;
  customVisitTypes?: unknown;
  optionalGoals?: unknown;
}

/** 捨てた候補と理由。**黙って落とさない**（何が通らなかったか分からないと直しようがない） */
export interface RejectedSuggestion {
  category: keyof SchemaSuggestion;
  name: string;
  reason: string;
}

export interface ValidateResult {
  suggestion: SchemaSuggestion;
  rejected: RejectedSuggestion[];
  /** 1 件でも通ったか。ゼロなら route は消費を確定させない */
  accepted: number;
}

/**
 * 重複判定用の正規化。**表示名は正規化しない**（ユーザーが書いた形をそのまま保存する）。
 * ここで潰すのは「同じものが二重に増える」原因になる差だけ:
 * 全角英数・全角空白・前後空白・大文字小文字・中黒/長音の揺れは対象外（意味が変わるため）。
 */
export function normalizeForCompare(raw: string): string {
  return raw
    .normalize('NFKC') // 全角英数 → 半角、全角空白 → 半角空白
    .replace(/\s+/g, '') // 語中の空白も落とす（「常 連」と「常連」を同一視）
    .toLowerCase();
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  // 改行はここで潰す。1 行の約束を守らせるだけでなく、
  // 複数行の "reason" に指示文を埋める形（注入）の運び先を消す
  const v = raw.replace(/[\r\n\t]+/g, ' ').trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/** 既存の 3 項目から、比較用の名前集合を作る。形が想定外でも落ちない */
function existingNames(existing: ExistingSchema | undefined): {
  customTags: Set<string>;
  customVisitTypes: Set<string>;
  optionalGoals: Set<string>;
} {
  const setOf = (raw: unknown, pick: (v: unknown) => unknown): Set<string> => {
    const out = new Set<string>();
    if (!Array.isArray(raw)) return out;
    for (const item of raw) {
      const name = pick(item);
      if (typeof name === 'string' && name.trim()) out.add(normalizeForCompare(name));
    }
    return out;
  };
  return {
    // customTags / customVisitTypes は文字列配列だが、旧データに {name} 形式が混ざりうる
    customTags: setOf(existing?.customTags, (v) => (typeof v === 'string' ? v : (v as { name?: unknown })?.name)),
    customVisitTypes: setOf(existing?.customVisitTypes, (v) => (typeof v === 'string' ? v : (v as { name?: unknown })?.name)),
    optionalGoals: setOf(existing?.optionalGoals, (v) => (v as { name?: unknown })?.name),
  };
}

function readMonthlyTarget(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  // 0 と負値は「省略」として扱う。0 を保存すると達成率の分母が 0 になる
  if (n <= 0) return undefined;
  return Math.min(n, MAX_MONTHLY_TARGET);
}

/**
 * モデルの出力を検証して、**そのまま画面に出せる形**にする。
 * 未知キーは黙って捨てる（受け入れる側の形は固定。仕様 §1.6 の「未知の受け入れ」は
 * 段 5 の `x` マップの話で、Phase 0 の提案には適用しない——提案の器は既存の 3 項目に閉じている）。
 */
export function validateSchemaSuggestion(
  raw: unknown,
  existing: ExistingSchema | undefined,
): ValidateResult {
  const rejected: RejectedSuggestion[] = [];
  const empty: SchemaSuggestion = { customTags: [], customVisitTypes: [], optionalGoals: [] };
  if (!raw || typeof raw !== 'object') {
    return { suggestion: empty, rejected, accepted: 0 };
  }
  const src = raw as Record<string, unknown>;
  const known = existingNames(existing);

  const takeNames = (
    category: 'customTags' | 'customVisitTypes',
  ): SuggestedName[] => {
    const list = src[category];
    if (!Array.isArray(list)) return [];
    const out: SuggestedName[] = [];
    // 同一提案内の重複も潰す（AI は同じ語を言い換えて 2 回出すことがある）
    const seen = new Set<string>();
    for (const item of list) {
      if (out.length >= MAX_PER_CATEGORY) {
        rejected.push({ category, name: String((item as { name?: unknown })?.name ?? ''), reason: `1 回に提案できるのは ${MAX_PER_CATEGORY} 件までです` });
        continue;
      }
      const name = cleanText((item as { name?: unknown })?.name, MAX_NAME_LENGTH);
      if (!name) continue;
      const key = normalizeForCompare(name);
      if (known[category].has(key)) {
        rejected.push({ category, name, reason: '既にある項目です' });
        continue;
      }
      if (seen.has(key)) {
        rejected.push({ category, name, reason: '同じ提案が重複しています' });
        continue;
      }
      const reason = cleanText((item as { reason?: unknown })?.reason, MAX_REASON_LENGTH);
      if (!reason) {
        // 理由が無いものは通さない。選ぶ判断材料が無い提案は「勝手な変更」になる
        rejected.push({ category, name, reason: '理由が書かれていないため採用しませんでした' });
        continue;
      }
      seen.add(key);
      out.push({ name, reason });
    }
    return out;
  };

  const takeGoals = (): SuggestedGoal[] => {
    const list = src.optionalGoals;
    if (!Array.isArray(list)) return [];
    const out: SuggestedGoal[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const obj = item as { name?: unknown; reason?: unknown; unit?: unknown; monthlyTarget?: unknown };
      if (out.length >= MAX_PER_CATEGORY) {
        rejected.push({ category: 'optionalGoals', name: String(obj?.name ?? ''), reason: `1 回に提案できるのは ${MAX_PER_CATEGORY} 件までです` });
        continue;
      }
      const name = cleanText(obj?.name, MAX_NAME_LENGTH);
      if (!name) continue;
      const key = normalizeForCompare(name);
      if (known.optionalGoals.has(key)) {
        rejected.push({ category: 'optionalGoals', name, reason: '既にある目標です' });
        continue;
      }
      if (seen.has(key)) {
        rejected.push({ category: 'optionalGoals', name, reason: '同じ提案が重複しています' });
        continue;
      }
      const unit = obj?.unit;
      if (typeof unit !== 'string' || !SUGGEST_UNITS.includes(unit as OptionalGoalUnit)) {
        // enum 外は iOS がデコード時に落とすため、サーバで確実に捨てる
        rejected.push({ category: 'optionalGoals', name, reason: `単位が ${SUGGEST_UNITS.join(' / ')} のいずれでもありません` });
        continue;
      }
      const reason = cleanText(obj?.reason, MAX_REASON_LENGTH);
      if (!reason) {
        rejected.push({ category: 'optionalGoals', name, reason: '理由が書かれていないため採用しませんでした' });
        continue;
      }
      seen.add(key);
      const monthlyTarget = readMonthlyTarget(obj?.monthlyTarget);
      out.push({ name, reason, unit: unit as OptionalGoalUnit, ...(monthlyTarget === undefined ? {} : { monthlyTarget }) });
    }
    return out;
  };

  const suggestion: SchemaSuggestion = {
    customTags: takeNames('customTags'),
    customVisitTypes: takeNames('customVisitTypes'),
    optionalGoals: takeGoals(),
  };
  const accepted =
    suggestion.customTags.length + suggestion.customVisitTypes.length + suggestion.optionalGoals.length;
  return { suggestion, rejected, accepted };
}
