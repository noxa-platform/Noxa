// 記録エンジン段 7: AI がルールパックを生成する — P151。
//
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §2.5 / 決定事項 3（**適用前に必ず人間の承認**）。
//
// AI が「項目（fields）」と「導出（derivations）」をまとめて提案し、人が差分を見て
// チェックしたものだけ適用する。**AI は保存しない。適用するのは人の操作。**
//
// ## 取り消しの決まり（2026-08-25・yorulog と合意）
//
// **`revert` は「AI が足した分だけを引く」。「直前の状態に戻す」ではない。**
//
// スナップショット復元にしない理由が 2 つある:
//   1. 間に人が手で足した項目まで巻き戻る
//   2. **間に人が意図的に消した項目が復活する**。増えたことより
//      「消したはずのものが戻る」方が気づきにくく、「勝手に増えた」と受け取られる
//
// さらに **間にユーザーが編集した項目は引かない**。表示名や目標を変えた時点でそれは
// **その人のもの**で、消すと編集を捨てることになる。引かなかったものは理由付きで返す
// （「元に戻したのに残っている」が説明なしだと、それはそれで不信になる）。
//
// Phase 0（P148）を「足すだけ」に閉じたので**引き算が全域で定義でき、版のスナップショットが要らない**。
// 保持するのは **1 世代**（適用直後に取り消せれば足りる、という UI 想定）。
import { parseRecordSchema, type FieldDef, type RecordSchema } from './record-schema';
import { parseExpr, type Expr } from './derivation';

/** 1 回のパックで足せる上限。多すぎる差分は人が確認できず「全部チェック」に倒れる */
export const MAX_PACK_FIELDS = 20;
export const MAX_PACK_DERIVATIONS = 10;

export interface PackDerivation {
  key: string;
  label: string;
  expr: Expr;
  /** なぜこの導出が要るのか。**理由の無いものは採用しない**（P148 と同じ扱い） */
  reason: string;
}

export interface PackField extends FieldDef {
  reason: string;
}

export interface RulePack {
  fields: PackField[];
  derivations: PackDerivation[];
}

export interface PackRejection {
  kind: 'field' | 'derivation';
  key: string;
  reason: string;
}

export interface ValidatedPack {
  pack: RulePack;
  rejected: PackRejection[];
  /** 採用できた件数。0 なら route は消費を確定させない */
  accepted: number;
}

/**
 * AI の生成物を検証する。**追加のみ**——既存項目の改名・削除・並べ替えは受け付けない
 * （Phase 0 と同じ縛り。これを崩すと取り消しがスナップショット復元になる）。
 */
export function validateRulePack(raw: unknown, current: RecordSchema, currentDerivationKeys: string[] = []): ValidatedPack {
  const rejected: PackRejection[] = [];
  const fields: PackField[] = [];
  const derivations: PackDerivation[] = [];
  const existingFieldKeys = new Set(current.fields.map((f) => f.key));
  const existingDerivKeys = new Set(currentDerivationKeys);

  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};

  // ── fields ──
  const rawFields = Array.isArray(src.fields) ? src.fields : [];
  const seenField = new Set<string>();
  for (const item of rawFields) {
    const key = String((item as { key?: unknown })?.key ?? '');
    if (fields.length >= MAX_PACK_FIELDS) {
      rejected.push({ kind: 'field', key, reason: `1 回に提案できる項目は ${MAX_PACK_FIELDS} 個までです` });
      continue;
    }
    // 記録エンジンの項目定義としての妥当性は段 5 の検証を再利用する（判定を 2 箇所に書かない）
    const { schema, rejected: fieldRejected } = parseRecordSchema({ fields: [item] });
    if (schema.fields.length === 0) {
      rejected.push({ kind: 'field', key, reason: fieldRejected[0]?.reason ?? '項目の形が不正です' });
      continue;
    }
    const def = schema.fields[0];
    if (existingFieldKeys.has(def.key)) {
      rejected.push({ kind: 'field', key: def.key, reason: '既にある項目です' });
      continue;
    }
    if (seenField.has(def.key)) {
      rejected.push({ kind: 'field', key: def.key, reason: '同じ提案が重複しています' });
      continue;
    }
    const reason = cleanReason((item as { reason?: unknown })?.reason);
    if (!reason) {
      rejected.push({ kind: 'field', key: def.key, reason: '理由が書かれていないため採用しませんでした' });
      continue;
    }
    seenField.add(def.key);
    fields.push({ ...def, reason });
  }

  // ── derivations ──
  const rawDerivs = Array.isArray(src.derivations) ? src.derivations : [];
  const seenDeriv = new Set<string>();
  // 導出は**このパックで足す項目も参照してよい**（新項目から新しい合計を作るのが本来の用途）
  const knownKeys = new Set([...existingFieldKeys, ...fields.map((f) => f.key)]);
  for (const item of rawDerivs) {
    const o = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
    const key = typeof o.key === 'string' ? o.key : '';
    if (derivations.length >= MAX_PACK_DERIVATIONS) {
      rejected.push({ kind: 'derivation', key, reason: `1 回に提案できる導出は ${MAX_PACK_DERIVATIONS} 個までです` });
      continue;
    }
    // 導出の出力先も記録の項目になるので、キーの形は段 5 と同じ縛りを通す
    const { schema } = parseRecordSchema({ fields: [{ key, type: 'count', label: key }] });
    if (schema.fields.length === 0) {
      rejected.push({ kind: 'derivation', key, reason: 'キーの形が不正です' });
      continue;
    }
    if (existingDerivKeys.has(key) || existingFieldKeys.has(key)) {
      rejected.push({ kind: 'derivation', key, reason: '既にある項目・導出と同じキーです' });
      continue;
    }
    if (seenDeriv.has(key)) {
      rejected.push({ kind: 'derivation', key, reason: '同じ提案が重複しています' });
      continue;
    }
    // **AI が書いた式をそのまま保存しない**（段 6 の検証を必ず通す。深さ・ノード数も見る）
    const parsed = parseExpr(o.expr);
    if (!parsed.ok) {
      rejected.push({ kind: 'derivation', key, reason: `式が不正です（${parsed.error.path}: ${parsed.error.reason}）` });
      continue;
    }
    // 存在しない項目を参照する式は、**適用しても永久に null を返す**。保存前に落とす
    const unknownRef = referencedFields(parsed.parsed.expr).find((f) => !knownKeys.has(f));
    if (unknownRef) {
      rejected.push({ kind: 'derivation', key, reason: `式が知らない項目「${unknownRef}」を参照しています` });
      continue;
    }
    const reason = cleanReason(o.reason);
    if (!reason) {
      rejected.push({ kind: 'derivation', key, reason: '理由が書かれていないため採用しませんでした' });
      continue;
    }
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : key;
    seenDeriv.add(key);
    derivations.push({ key, label, expr: parsed.parsed.expr, reason });
  }

  return { pack: { fields, derivations }, rejected, accepted: fields.length + derivations.length };
}

function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/[\r\n\t]+/g, ' ').trim();
  return v ? v.slice(0, 80) : null;
}

/** 式が参照している項目名を全部集める */
export function referencedFields(expr: Expr): string[] {
  const out: string[] = [];
  const walk = (e: Expr): void => {
    if ('field' in e) { out.push(e.field); return; }
    if ('op' in e || 'cmp' in e) { walk(e.args[0]); walk(e.args[1]); return; }
    if ('if' in e) { walk(e.if); walk(e.then); walk(e.else); return; }
    if ('coalesce' in e) { walk(e.coalesce[0]); walk(e.coalesce[1]); }
  };
  walk(expr);
  return [...new Set(out)];
}

// ── 適用と取り消し ─────────────────────────────────────

/**
 * 適用の控え。**取り消しに必要な最小限だけ**を持つ。
 * スナップショット（適用前の全体）は持たない——復元してしまうと、間に人が消した項目が戻る。
 */
export interface ApplyReceipt {
  token: string;
  appliedAt: number;
  /** 足した項目と、**足した時点の姿**。編集されたかの判定に使う */
  fields: FieldDef[];
  derivations: { key: string; label: string; expr: Expr }[];
}

export interface ApplyResult {
  schema: RecordSchema;
  derivations: { key: string; label: string; expr: Expr }[];
  receipt: ApplyReceipt;
  /** 選ばれたが適用できなかったもの（適用の直前に他の人が同じキーを足した等） */
  skipped: PackRejection[];
}

/**
 * 人が選んだものだけを適用する。**選ばれていないものは触らない。**
 * `selectedKeys` を渡さなければ全部が対象（テストと「全部適用」ボタン用）。
 */
export function applyRulePack(
  current: RecordSchema,
  currentDerivations: { key: string; label: string; expr: Expr }[],
  pack: RulePack,
  opts: { token: string; now: number; selectedKeys?: string[] },
): ApplyResult {
  const selected = opts.selectedKeys ? new Set(opts.selectedKeys) : null;
  const skipped: PackRejection[] = [];
  const existingFieldKeys = new Set(current.fields.map((f) => f.key));
  const existingDerivKeys = new Set(currentDerivations.map((d) => d.key));

  const addedFields: FieldDef[] = [];
  for (const f of pack.fields) {
    if (selected && !selected.has(f.key)) continue;
    if (existingFieldKeys.has(f.key)) {
      // 生成から適用までの間に、別の人が同じキーを足していた
      skipped.push({ kind: 'field', key: f.key, reason: '適用しようとした時点で既にありました' });
      continue;
    }
    const { reason: _reason, ...def } = f;
    void _reason; // 理由は提案の説明。保存する項目定義には含めない
    addedFields.push(def);
    existingFieldKeys.add(f.key);
  }

  const addedDerivations: { key: string; label: string; expr: Expr }[] = [];
  for (const d of pack.derivations) {
    if (selected && !selected.has(d.key)) continue;
    if (existingDerivKeys.has(d.key) || existingFieldKeys.has(d.key)) {
      skipped.push({ kind: 'derivation', key: d.key, reason: '適用しようとした時点で既にありました' });
      continue;
    }
    addedDerivations.push({ key: d.key, label: d.label, expr: d.expr });
    existingDerivKeys.add(d.key);
  }

  return {
    schema: { ...current, fields: [...current.fields, ...addedFields] },
    derivations: [...currentDerivations, ...addedDerivations],
    receipt: { token: opts.token, appliedAt: opts.now, fields: addedFields, derivations: addedDerivations },
    skipped,
  };
}

export interface RevertSkip {
  kind: 'field' | 'derivation';
  key: string;
  reason: string;
}

export interface RevertResult {
  schema: RecordSchema;
  derivations: { key: string; label: string; expr: Expr }[];
  removed: string[];
  /** 引かなかったものと理由。**画面に出す**（説明なしに残ると不信になる） */
  skipped: RevertSkip[];
}

/**
 * 控えに載っているものだけを引く。
 *
 * **引かないもの**:
 *   - 既に無いもの（誰かが先に消した）
 *   - **足した時点から姿が変わっているもの**（表示名・型・目標などを人が編集した）
 *
 * ⚠️ **記録に書かれた値（`x` の中身）は消さない。** 項目定義を消しても、その項目で
 * 既に入力された値は記録に残る。仕様 §1.6 のとおり未知キーは保持されるので、
 * **後から同じキーで項目を作り直せば、過去の入力もそのまま生き返る**。
 */
export function revertRulePack(
  current: RecordSchema,
  currentDerivations: { key: string; label: string; expr: Expr }[],
  receipt: ApplyReceipt,
): RevertResult {
  const skipped: RevertSkip[] = [];
  const removed: string[] = [];

  const fieldByKey = new Map(current.fields.map((f) => [f.key, f]));
  const removeFieldKeys = new Set<string>();
  for (const original of receipt.fields) {
    const now = fieldByKey.get(original.key);
    if (!now) {
      skipped.push({ kind: 'field', key: original.key, reason: '既に削除されていました' });
      continue;
    }
    if (!sameField(now, original)) {
      // 編集された時点でそれは「その人のもの」。消すと編集を捨てることになる
      skipped.push({ kind: 'field', key: original.key, reason: '適用後に編集されているため残しました' });
      continue;
    }
    removeFieldKeys.add(original.key);
    removed.push(original.key);
  }

  const derivByKey = new Map(currentDerivations.map((d) => [d.key, d]));
  const removeDerivKeys = new Set<string>();
  for (const original of receipt.derivations) {
    const now = derivByKey.get(original.key);
    if (!now) {
      skipped.push({ kind: 'derivation', key: original.key, reason: '既に削除されていました' });
      continue;
    }
    if (now.label !== original.label || JSON.stringify(now.expr) !== JSON.stringify(original.expr)) {
      skipped.push({ kind: 'derivation', key: original.key, reason: '適用後に編集されているため残しました' });
      continue;
    }
    removeDerivKeys.add(original.key);
    removed.push(original.key);
  }

  // 残す導出が、消す項目を参照していないか。参照していたら**その項目は消せない**
  // （消すと導出が永久に null を返す。壊れた式を残すより、項目を残す方が害が小さい）
  const keptDerivations = currentDerivations.filter((d) => !removeDerivKeys.has(d.key));
  for (const key of [...removeFieldKeys]) {
    const user = keptDerivations.find((d) => referencedFields(d.expr).includes(key));
    if (user) {
      removeFieldKeys.delete(key);
      const i = removed.indexOf(key);
      if (i >= 0) removed.splice(i, 1);
      skipped.push({ kind: 'field', key, reason: `導出「${user.label}」が使っているため残しました` });
    }
  }

  return {
    schema: { ...current, fields: current.fields.filter((f) => !removeFieldKeys.has(f.key)) },
    derivations: keptDerivations,
    removed,
    skipped,
  };
}

/** 足した時点の姿と同じか。**表示名・型・付随情報のどれか 1 つでも違えば編集された扱い** */
function sameField(a: FieldDef, b: FieldDef): boolean {
  return JSON.stringify(normalizeField(a)) === JSON.stringify(normalizeField(b));
}

function normalizeField(f: FieldDef): unknown {
  // キーの順序で差が出ないように並べ直す
  return {
    key: f.key, type: f.type, label: f.label, roles: [...f.roles].sort(),
    options: f.options ? [...f.options] : null,
    direction: f.direction ?? null, scale: f.scale ?? null,
    target: f.target ?? null, scope: f.scope ?? null,
  };
}
