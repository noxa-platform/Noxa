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
// **キー名の形も値の型も rules では検査できない**。
//
// ## ⚠️ ここは「唯一の番人」では**ない**（2026-08-26・P154-PM4 で実測して訂正）
//
// 以前ここには「この検証関数が**唯一の番人**で、書き手（Web / iOS / nomishugy / CF）は
// 全員ここを通す」と書いてあった。**通っていない。** 実測:
//
// - **Web**: `validateXMap` の本番の呼び出し元は **0**（唯一の呼び出し元 `derivationsToXPatch`
//   自体もテストからしか呼ばれていない）。`x` を書く経路がまだ無いので当然ではある。
// - **iOS**: `x` を**サーバ経由で書いていない**。`LogService` が `data["x.\(key)"] = …` で
//   Firestore へ直接 `updateData` する（約束 1 の「1 キーずつ」を守った形）。
//   守っているのは端末側の `RecordSchemaPlan.validate`＝**この関数の写し**（yorulog 実測）。
// - **CF**: 呼び出し元なし。
// - **nomishugy**: 未確認（別セッションのリポなので触っていない）。
//
// ＝ 実態は「**各書き手が自分の写しで守っている**」であって、共通の関門はどこにも無い。
// クライアントから直接書ける以上、**サーバは構造的に書き込み経路に入れない**（1 ホップ挟むと
// オフライン保存が壊れる）ので、これは欠陥というより**そうならざるを得ない形**。
//
// だからこのファイルの役割は「関門」ではなく **仕様の実装＋各写しの照合先**。扱い方:
//   - ここを変えたら**写しを持つ側（現状 iOS）へ必ず知らせる**（terminology の
//     `lexicon-snapshot.json` と同じ立て付け。あちらは食い違うとテストが落ちて気づける）。
//   - 「ここを通しているから安全」と書かない。**通っていないものは守られていない**。
//   - ⚠️ 呼び出し元が変わったら下の `record-engine-record-schema.test.ts` の
//     「本番の呼び出し元」テストが落ちる。落ちたら**この段落を書き直す**（実測を先に）。
//
// 💡 この訂正が P153-PM4 の**後**に出たのが要点。PM4 は「唯一の番人」の写し 4 箇所に
//    *値についてだけ* という限定を足したが、**限定を足した本人が、限定した文の前提
//    （＝そもそも全員が通っているのか）を一度も確かめていなかった**。
//
// ⚠️ **さらに、写しが見ているのも*値*についてだけ**（2026-08-25・iOS の入力 UI 実装で判明）。
// `validateXMap` が見るのは**書こうとしている値のマップ**であって、**差分の組み立て方**——
// とくに「**消す**」という指示——は**一度もここを通らない**。構造的に見る機会が無い。
// 下の「書き手の約束」4 / 5 の事故（通信断で全項目を消す差分ができる、描けなかった値が
// 未入力で上書きされる）は、**どれも正しい形の差分として届く**ので検証では捕まえられない。
// 値の検証と、差分の組み立ての正しさは**別の問題**として手当てすること。
//
// ## 書き手の約束（2026-08-25・iOS 実装時に確定。P153-PM で明文化）
//
// 1. **`x` をマップごと差し替えない。`x.<key>` のフィールドパスで 1 キーずつ書く。**
//    マップごと上書きすると、その端末が知らない項目（別クライアントや AI が入れたもの、
//    まだ描けない型）が**記録を開いて保存するだけで消える**。§1.6 の「読み込み→保存で
//    他クライアントの新機能を消さない」は、検証関数だけでなく**書き込みの形**の話でもある。
//    ⚠️ 2026-08-25 時点で `x` を書く経路は iOS だけ（Web・CF は未実装）。Web を作るときも同じ形にする。
// 2. **`when` / `period.start` / `period.end` はエポック**ミリ秒**（UTC 基準の数値）。**
//    仕様に単位の記述が無く iOS 側で決めた値を、ここで共有の約束として固定する。
//    ⚠️ **秒とミリ秒が混ざると検証は素通りする**（どちらも有限数）。混ざったまま集計すると
//    日付が 50 年ずれるが、エラーは 1 つも出ない。**単位はコードで縛れないので約束で守る**。
// 3. **空欄はキーごと持たない**（`0` や空文字を入れない）。0 は「ゼロという測定結果」で、
//    合計にも平均にも効いてしまう。P150 の「分からないを 0 にしない」と同じ。
// 4. **スキーマを読めていないなら `x` を触らない。** 読み込み失敗を「項目なし」として進むと、
//    **全項目を消す差分**ができる。通信断が「ユーザーが全部消した」に化ける。
// 5. **入力欄に戻せなかった値は触らない。** 項目の型を後から変えると型と値が食い違い、
//    UI に出せない値が生まれる。それを空欄として描くと、**保存の瞬間に「未入力」で上書きされて消える**。
//    出せないものは読み取り専用で見せて、差分から外す（§1.6 の `opaque` と同じ扱い）。
//    ※ 4 / 5 は iOS が入力 UI（yorulog P108）で実際に塞いだ経路。**検証関数では捕まえられない**
//      （どちらも「正しい形の差分」として届くため）。Web で入力 UI を作るときも同じ手当てが要る。
// 6. Firestore の作法: **`update` のフィールドパスはドットで階層になるが、`set` ではキー名そのもの**。
//    新規作成だけは `x` を丸ごと渡してよい（消える先が無い）。既存への追記は必ず `update`。
// 7. **`trimmed` を握り潰さない**（2026-08-26・P154-PM3）。`validateXMap` / `parseRecordSchema` は
//    上限を超えた値を**保存したうえで切り詰める**（doc の肥大を防ぐため切ること自体は必要）。
//    ⚠️ **切ったことを言わずに保存すると、利用者が入れた文字がその場で黙って消える。**
//    しかも `parseRecordSchema` の側は**読んだ姿をそのまま書き戻す**経路があるため、
//    **今回の操作と無関係な項目が恒久的に削られる**（`/api/record-engine/apply`）。
//    切ったことを言えるのは**その 1 回だけ**で、次に読み直したときにはもう「切られた形」が
//    正常な姿に見える＝**言い逃すと二度と気づけない**。返ってきた `trimmed` は必ず画面に出す。
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

/** 表示名・参照先の最大長 */
export const MAX_LABEL_LENGTH = 60;
/** 1 項目に指定できる役割の数 */
export const MAX_ROLES = 10;
/** 1 項目に持てる選択肢の数 */
export const MAX_OPTIONS = 100;

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
export function parseRecordSchema(
  raw: unknown,
): { schema: RecordSchema; rejected: RejectedField[]; trimmed: RejectedField[] } {
  const rejected: RejectedField[] = [];
  // 「採用したが**中身を削った**」もの。`rejected`（採用しなかった）とは別勘定にする——
  // 混ぜると「選んだ数 = 足した数 + 引かなかった数」の検算（P153-PM25）が合わなくなる
  const trimmed: RejectedField[] = [];
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
      if (seen.has(parsed.def.key)) {
        rejected.push({ key: parsed.def.key, reason: 'キーが重複しています' });
        continue;
      }
      seen.add(parsed.def.key);
      fields.push(parsed.def);
      trimmed.push(...parsed.trimmed);
    }
  }
  const irVersion = readIrVersion(raw);
  return {
    schema: { fields, ...(irVersion > IR_VERSION_LEGACY ? { ir_version: irVersion } : {}) },
    rejected,
    trimmed,
  };
}

/**
 * 1 項目を読む。**採用したうえで中身を削った**ときは `trimmed` に理由を載せる（P154-PM3）。
 *
 * ⚠️ 上限で切ること自体は必要（doc が肥大すると全員の記録画面が開かなくなる）。
 * 悪いのは**切ったことを言わずに、切った後の姿を「その項目そのもの」の顔で出す**こと。
 * とくに `apply` は**読んだ姿をそのまま書き戻す**ので、黙って切ると
 * **無関係な適用 1 回で恒久的に消える**（yorulog の `paidSoFar` と同じ形——
 * 正規化して保存し直すのに、正規化した事実を誰にも伝えていない）。
 */
function parseFieldDef(raw: unknown): { def: FieldDef; trimmed: RejectedField[] } | RejectedField {
  if (!raw || typeof raw !== 'object') return { key: '', reason: '項目の形が不正です' };
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key : '';
  if (!FIELD_KEY_PATTERN.test(key)) {
    return { key, reason: 'キーは英小文字で始まり、英小文字・数字・_ のみ 40 字までです' };
  }
  const trimmed: RejectedField[] = [];
  const rawLabel = typeof o.label === 'string' ? o.label.trim() : '';
  if (rawLabel.length > MAX_LABEL_LENGTH) {
    trimmed.push({ key, reason: `表示名が ${MAX_LABEL_LENGTH} 字を超えたため切り詰めました` });
  }
  const label = rawLabel ? rawLabel.slice(0, MAX_LABEL_LENGTH) : key;
  // **知らない型は拒否せず opaque にする**（§1.6）。拒否すると、新しい型を使う
  // 別クライアントの記録がこちらで丸ごと読めなくなる
  const rawType = typeof o.type === 'string' ? o.type : '';
  const type: FieldType | typeof OPAQUE =
    (FIELD_TYPES as readonly string[]).includes(rawType) ? (rawType as FieldType) : OPAQUE;
  const allRoles = Array.isArray(o.roles)
    ? o.roles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];
  if (allRoles.length > MAX_ROLES) {
    // ⚠️ `roles` は**その項目を誰に出すか**。黙って切ると、11 人目以降の役割の人だけ
    // 項目が消える——本人にも設定した人にも理由が見えない
    trimmed.push({ key, reason: `対象の役割が ${MAX_ROLES} 個を超えたため ${allRoles.length - MAX_ROLES} 個を落としました` });
  }
  const roles = allRoles.slice(0, MAX_ROLES);
  const def: FieldDef = { key, type, label, roles };
  const allOptions = Array.isArray(o.options)
    ? o.options.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : undefined;
  if (allOptions && allOptions.length > MAX_OPTIONS) {
    // ⚠️ 選択肢が消えると、**過去にその選択肢で入力された記録が「知らない値」になる**
    trimmed.push({ key, reason: `選択肢が ${MAX_OPTIONS} 個を超えたため ${allOptions.length - MAX_OPTIONS} 個を落としました` });
  }
  const options = allOptions?.slice(0, MAX_OPTIONS);
  if (options && options.length) def.options = options;
  if (o.direction === 'in' || o.direction === 'out' || o.direction === 'discount') def.direction = o.direction;
  if (typeof o.scale === 'number' && Number.isFinite(o.scale) && o.scale >= 2 && o.scale <= 100) {
    def.scale = Math.floor(o.scale);
  }
  if (typeof o.target === 'string' && o.target.trim()) {
    const t = o.target.trim();
    if (t.length > MAX_LABEL_LENGTH) {
      // 参照先が切り詰められると**別のものを指す**（黙って切るのが一番まずい種類）
      trimmed.push({ key, reason: `参照先が ${MAX_LABEL_LENGTH} 字を超えたため切り詰めました` });
    }
    def.target = t.slice(0, MAX_LABEL_LENGTH);
  }
  if (o.scope === 'self' || o.scope === 'shop' || o.scope === 'org' || o.scope === 'public') def.scope = o.scope;
  return { def, trimmed };
}

// ── 記録側（`x` マップ）の検証 ─────────────────────────

export interface ValidateXResult {
  /** 保存してよい形にした `x`。**未知キーも残す**（§1.6） */
  x: Record<string, unknown>;
  rejected: RejectedField[];
  /**
   * **保存はしたが中身を削った**もの（P154-PM3）。`rejected`（保存しなかった）とは別勘定。
   * ⚠️ ここは書き込み経路なので、黙って切ると**利用者が入れた文字がその場で消える**。
   */
  trimmed: RejectedField[];
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
  const trimmed: RejectedField[] = [];
  const x: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { x, rejected, trimmed };
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
    for (const reason of checked.trimmed ?? []) trimmed.push({ key, reason });
    x[key] = checked.value;
  }
  return { x, rejected, trimmed };
}

/**
 * 1 つの値を検証する。**保存したうえで中身を削った**ときは `trimmed` に理由を載せる。
 * 上限で切ること自体は必要だが、**切ったことを言わずに保存すると、利用者が入れた文字が
 * その場で黙って消える**（P154-PM3）。
 */
function checkValue(
  value: unknown,
  def: FieldDef | undefined,
): { value: unknown; trimmed?: string[] } | { reason: string } {
  if (value === null || value === undefined) return { value: null };

  if (typeof value === 'number') {
    // **`NaN` / `Infinity` は 1 個混ざるだけで合計が全部 NaN になる。**
    // Firestore は保存できてしまうので、ここで止めるしかない
    if (!Number.isFinite(value)) return { reason: '数値が有限ではありません' };
    return { value };
  }
  if (typeof value === 'boolean') return { value };
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      return {
        value: value.slice(0, MAX_STRING_LENGTH),
        trimmed: [`${MAX_STRING_LENGTH} 字を超えたため ${value.length - MAX_STRING_LENGTH} 字を切りました`],
      };
    }
    return { value };
  }
  if (Array.isArray(value)) {
    // `tags` 想定。要素は文字列に限る（入れ子の配列/マップは集計不能で、深さの上限も要る）
    const strings = value.filter((v): v is string => typeof v === 'string');
    if (strings.length !== value.length) {
      return { reason: '配列に文字列以外が含まれています' };
    }
    const notes: string[] = [];
    if (strings.length > MAX_TAGS) {
      notes.push(`${MAX_TAGS} 個を超えたため ${strings.length - MAX_TAGS} 個を落としました`);
    }
    const items = strings.slice(0, MAX_TAGS);
    const longs = items.filter((v) => v.length > MAX_STRING_LENGTH).length;
    if (longs > 0) notes.push(`${longs} 個の値が ${MAX_STRING_LENGTH} 字を超えたため切りました`);
    return {
      value: items.map((v) => (v.length > MAX_STRING_LENGTH ? v.slice(0, MAX_STRING_LENGTH) : v)),
      ...(notes.length ? { trimmed: notes } : {}),
    };
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
