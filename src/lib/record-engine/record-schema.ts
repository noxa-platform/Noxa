// 記録エンジン段 5: 自由項目（`record_schema` + 記録側の `x` マップ）— P149。
//
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §1.2（値の型）/ §1.6（未知の受け入れ）/ §2.1（語彙）。
//
// ## 置き場所（2026-08-25・yorulog と合意）
//
// - 店:   `shop_shops/{shopId}/settings/record_schema`   ← **単一 doc**
// - 個人: `account_users/{uid}/settings/record_schema`   ← 同上（P133 の個人設定と同じ場所）
//
// **コレクションではなく単一 doc にした理由**: セキュリティルールから `get()` で参照する必要が
// あるため。コレクションだと**どの doc を読めばいいか rules 側で決められない**（繰り返しが書けず、
// 1 リクエストの参照 doc 数にも上限がある）。P144 で `orgPath` を非正規化したのと同じ制約。
// 複数版が要るようになった時点でコレクションへ移す。
//
// ## 記録側は `x` マップ 1 つに閉じる
//
// トップレベルに項目を生やさない。生やすと rules も iOS の Codable も**項目が増えるたびに変更**に
// なり、「エンジンのコードを触らずに項目を足せる」という設計目標（仕様の前提 2）が壊れる。
//
// ⚠️ **既存の固定項目（`salesAmount` / `visitType` 等）は `x` へ移さない。**
// 移すと過去データの再集計が要り、営業日まわり（Day86〜88）が全部揺れる。**新規項目だけ `x`**。
//
// ## rules で守れることと守れないこと（重要）
//
// Firestore のルールは**マップのキーを 1 つずつ検査できない**（繰り返しが書けない）。
// そのため rules で縛れるのは「`x` がマップであること」「キー数の上限」までで、
// **キー名の形も値の型も rules では検査できない**。＝ ここの検証関数が**唯一の番人**になる。
// 書き手（Web / iOS / nomishugy / CF）は全員ここを通すこと。
import { readIrVersion, IR_VERSION_LEGACY } from '@/lib/ir-version';

/** 値の型。§1.2 の 10 種 + 未知 1（`opaque`）。**未知を拒否せず opaque で保持する** */
export const FIELD_TYPES = [
  'money', 'count', 'duration', 'when', 'period', 'grade', 'category', 'tags', 'ref', 'note',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** 知らない型の受け皿。**表示はするが集計には出さない**（§1.6） */
export const OPAQUE = 'opaque';

/**
 * 項目キーの形。**表示名と分ける**ための不変キー。
 *
 * ここを縛らないと、店が付けた表示名がそのままキーになり、**改名のたびに別項目になって
 * 集計が割れる**（P148 で「常連 / 常　連」として踏んだ重複問題の、取り返しのつかない版）。
 * 先頭は英小文字、以降は英小文字・数字・アンダースコアのみ、40 字まで。
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** 1 記録あたりのキー数上限（rules 側でも同じ値を縛る） */
export const MAX_X_KEYS = 50;
/** 文字列 1 値の上限。長文は `note` 型でもここで頭打ちにする */
export const MAX_STRING_LENGTH = 2000;
/** `tags` の要素数上限。無制限だと 1 記録で配列が膨らみ、読み取りが重くなる */
export const MAX_TAGS = 30;
/** スキーマに定義できる項目数の上限 */
export const MAX_FIELDS = 200;

export interface FieldDef {
  /** 不変キー。表示名を変えてもこれは変わらない */
  key: string;
  type: FieldType | typeof OPAQUE;
  /** 画面に出す名前。自由に変えてよい */
  label: string;
  /** 集計はこれを見る。ラベルも key も見ない（§2.1） */
  roles: string[];
  /** `category` / `tags` の選択肢 */
  options?: string[];
  /** `money` の向き。値に符号を埋めない（§1.2） */
  direction?: 'in' | 'out' | 'discount';
  /** `grade` の段階数 */
  scale?: number;
  /** `ref` の参照先 */
  target?: string;
  /** `ref` のスコープ。これが無いと個人の顧客と店の顧客を同じ ID 空間として扱う（§1.3） */
  scope?: 'self' | 'shop' | 'org' | 'public';
}

export interface RecordSchema {
  fields: FieldDef[];
  ir_version?: number;
}

export interface RejectedField {
  key: string;
  reason: string;
}

// ── スキーマ側の検証 ───────────────────────────────────

/**
 * スキーマ doc を読む。**壊れた項目は落とすが、doc 全体を捨てない**——
 * 1 項目の不正で店の全項目が消えると、記録画面が丸ごと使えなくなる。
 */
export function parseRecordSchema(raw: unknown): { schema: RecordSchema; rejected: RejectedField[] } {
  const rejected: RejectedField[] = [];
  const fields: FieldDef[] = [];
  const seen = new Set<string>();
  const list = (raw as { fields?: unknown } | null)?.fields;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (fields.length >= MAX_FIELDS) {
        rejected.push({ key: String((item as { key?: unknown })?.key ?? ''), reason: `項目は ${MAX_FIELDS} 個までです` });
        continue;
      }
      const parsed = parseFieldDef(item);
      if ('reason' in parsed) { rejected.push(parsed); continue; }
      if (seen.has(parsed.key)) {
        rejected.push({ key: parsed.key, reason: 'キーが重複しています' });
        continue;
      }
      seen.add(parsed.key);
      fields.push(parsed);
    }
  }
  const irVersion = readIrVersion(raw);
  return {
    schema: { fields, ...(irVersion > IR_VERSION_LEGACY ? { ir_version: irVersion } : {}) },
    rejected,
  };
}

function parseFieldDef(raw: unknown): FieldDef | RejectedField {
  if (!raw || typeof raw !== 'object') return { key: '', reason: '項目の形が不正です' };
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : '';
  if (!FIELD_KEY_PATTERN.test(key)) {
    return { key, reason: 'キーは英小文字で始まり、英小文字・数字・_ のみ 40 字までです' };
  }
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 60) : key;
  // **知らない型は拒否せず opaque にする**（§1.6）。拒否すると、新しい型を使う
  // 別クライアントの記録がこちらで丸ごと読めなくなる
  const rawType = typeof o.type === 'string' ? o.type : '';
  const type: FieldType | typeof OPAQUE =
    (FIELD_TYPES as readonly string[]).includes(rawType) ? (rawType as FieldType) : OPAQUE;
  const roles = Array.isArray(o.roles)
    ? o.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, 10)
    : [];
  const def: FieldDef = { key, type, label, roles };
  const options = Array.isArray(o.options)
    ? o.options.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 100)
    : undefined;
  if (options && options.length) def.options = options;
  if (o.direction === 'in' || o.direction === 'out' || o.direction === 'discount') def.direction = o.direction;
  if (typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale >= 2 && o.scale <= 100) {
    def.scale = Math.floor(o.scale);
  }
  if (typeof o.target === 'string' && o.target.trim()) def.target = o.target.trim().slice(0, 60);
  if (o.scope === 'self' || o.scope === 'shop' || o.scope === 'org' || o.scope === 'public') def.scope = o.scope;
  return def;
}

// ── 記録側（`x` マップ）の検証 ─────────────────────────

export interface ValidateXResult {
  /** 保存してよい形にした `x`。**未知キーも残す**（§1.6） */
  x: Record<string, unknown>;
  rejected: RejectedField[];
}

/**
 * 記録に載せる `x` を検証する。
 *
 * **未知キーは落とさない**（§1.6）。読み込み→保存の往復で、別クライアントの新機能が
 * 書いた項目を消してしまうため。落とすのは「保存すると壊れるもの」だけ:
 * キー名の形・件数・値の大きさ・非有限数。
 *
 * `schema` を渡すと型に沿った検証も行う。**渡さなくても動く**——スキーマを取得できない
 * 経路（オフライン保存など）で書けなくなる方が害が大きい。
 */
export function validateXMap(raw: unknown, schema?: RecordSchema): ValidateXResult {
  const rejected: RejectedField[] = [];
  const x: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { x, rejected };
  const byKey = new Map((schema?.fields ?? []).map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(x).length >= MAX_X_KEYS) {
      rejected.push({ key, reason: `1 記録に持てる項目は ${MAX_X_KEYS} 個までです` });
      continue;
    }
    if (!FIELD_KEY_PATTERN.test(key)) {
      // 表示名がそのままキーになるのを構造的に防ぐ。ここだけは未知でも通さない
      rejected.push({ key, reason: 'キーの形が不正です（英小文字で始まり、英小文字・数字・_ のみ 40 字まで）' });
      continue;
    }
    const checked = checkValue(value, byKey.get(key));
    if ('reason' in checked) { rejected.push({ key, reason: checked.reason }); continue; }
    x[key] = checked.value;
  }
  return { x, rejected };
}

function checkValue(value: unknown, def: FieldDef | undefined): { value: unknown } | { reason: string } {
  if (value === null || value === undefined) return { value: null };

  if (typeof value === 'number') {
    // **`NaN` / `Infinity` は 1 個混ざるだけで合計が全部 NaN になる。**
    // Firestore は保存できてしまうので、ここで止めるしかない
    if (!Number.isFinite(value)) return { reason: '数値が有限ではありません' };
    return { value };
  }
  if (typeof value === 'boolean') return { value };
  if (typeof value === 'string') {
    return { value: value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value };
  }
  if (Array.isArray(value)) {
    // `tags` 想定。要素は文字列に限る（入れ子の配列/マップは集計不能で、深さの上限も要る）
    const items = value.filter((v): v is string => typeof v === 'string').slice(0, MAX_TAGS);
    if (items.length !== value.length && value.some((v) => typeof v !== 'string')) {
      return { reason: '配列に文字列以外が含まれています' };
    }
    return { value: items.map((v) => (v.length > MAX_STRING_LENGTH ? v.slice(0, MAX_STRING_LENGTH) : v)) };
  }
  if (typeof value === 'object') {
    // `period`（start / end）だけは 1 段のマップを許す。それ以外の入れ子は許さない——
    // 深さを許すと rules でもクライアントでも検査できない領域が広がる
    if (def?.type === 'period') return checkPeriod(value as Record<string, unknown>);
    return { reason: '入れ子の値は保存できません（period のみ start / end を許可）' };
  }
  return { reason: '保存できない型です' };
}

function checkPeriod(v: Record<string, unknown>): { value: unknown } | { reason: string } {
  const num = (k: string): number | null => {
    const raw = v[k];
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return NaN; // 不正の印
    return raw;
  };
  const start = num('start');
  const end = num('end');
  if (Number.isNaN(start) || Number.isNaN(end)) return { reason: 'period の start / end が数値ではありません' };
  // end は開区間（§1.2）。start > end は期間として成立しない
  if (start !== null && end !== null && start > end) return { reason: 'period の start が end より後です' };
  return { value: { start: start ?? null, end: end ?? null } };
}

/**
 * 集計に載せてよい値か。**`opaque` と `note` は集計しない**（§1.2 / §1.6）。
 * 「集計できません」と明示するために、落とす側ではなく**判定として**提供する。
 */
export function isAggregatable(def: FieldDef | undefined): boolean {
  if (!def) return false; // スキーマに無い項目＝未知。保持はするが集計には出さない
  return def.type !== OPAQUE && def.type !== 'note';
}
