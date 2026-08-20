/**
 * AI が提案した料金設定を受け取るための検証・正規化（P129・純関数）。
 *
 * これは「AI が Config を書く」機能の**入口の栓**であって、便利関数ではない。
 * 料金設定は伝票の金額に直結する（Day115 / 123 / 124 で潰した事故は全部
 * 「間違った料金設定のまま伝票が作られる」形だった）。モデルの出力をそのまま
 * 画面に載せると、人は「AI がそう言っている」という理由で承認してしまう。
 *
 * 3 つの制約を型で強制する:
 *
 *   1. **プレビューに金額として現れる項目しか受け付けない**（`WRITABLE_FIELDS`）。
 *      `src/lib/pos/preview.ts` のテスト伝票に出ない項目は、人が承認する材料が無い。
 *      確かめる手段の無い数字を AI に書かせるのは、承認フローの見た目だけ作って
 *      中身を空にする行為になる。メニュー・卓名・半額ルール・カテゴリは対象外
 *      （プレビューに金額として出ないため。人が編集する）。
 *
 *   2. **全 Config ではなくパッチとして受ける**。丸ごと生成させると、モデルが
 *      言及しなかった項目が既定値で埋まって既存設定を消す（Day110 の事故と同型）。
 *      ここで返すのは `Partial<StoreConfig>` で、呼び出し側が現行 config に重ねる。
 *
 *   3. **捨てたものを黙らせない**。未知キー・型違い・範囲外は捨てるが、
 *      理由つきで `rejected` に載せて返す。「AI が 10 項目提案したのに 3 項目しか
 *      反映されない」ことを人が知らないまま承認するのが一番危ない。
 */
import type { StoreConfig } from './types';

/** 金額の上限（1 件あたり）。これを超える提案は誤りとして弾く */
const MAX_YEN = 1_000_000;
/** 税率・サービス料の上限（50%）。小数（0.1 = 10%）で保持する */
const MAX_RATE = 0.5;
/** 時刻は 24h+ 表記（翌 1 時 = 25）。閉店 30 時（翌 6 時）を上限とする */
const MAX_HOUR = 30;

export type RejectedField = {
  /** 提案されたキー（ドット区切り。例 `regularPricing.ext`） */
  path: string;
  /** 現場が読んで分かる理由 */
  reason: string;
};

export type ValidatedConfigPatch = {
  /** 現行 config に重ねられる形の差分。空なら採用できる提案が無かった */
  patch: Partial<StoreConfig>;
  /** 採用した項目のパス（画面で「何が変わるか」を出すため） */
  accepted: string[];
  /** 捨てた項目と理由 */
  rejected: RejectedField[];
};

/** 金額として妥当か（整数・0 以上・上限内） */
function validYen(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= MAX_YEN;
}
/** 率として妥当か（0〜0.5 の小数） */
function validRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RATE;
}
/** 時刻として妥当か（0〜30 の整数・24h+ 表記） */
function validHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= MAX_HOUR;
}

type FieldKind = 'yen' | 'rate' | 'hour';

const KIND_LABEL: Record<FieldKind, string> = {
  yen: `0〜${MAX_YEN.toLocaleString('ja-JP')} 円の整数`,
  rate: `0〜${MAX_RATE * 100}% の割合（小数。10% なら 0.1）`,
  hour: `0〜${MAX_HOUR} の整数（翌1時は 25 と書く）`,
};

const CHECK: Record<FieldKind, (v: unknown) => boolean> = {
  yen: validYen, rate: validRate, hour: validHour,
};

/** 客層別料金（初回 / R内 / R後）の項目 */
const CUSTOMER_PRICING_KEYS = ['set', 'ext', 'nom', 'tc'] as const;
/** 通常料金の項目 */
const REGULAR_PRICING_KEYS = {
  earlySet: 'yen', lateSet: 'yen', ext: 'yen', nom: 'yen', tc: 'yen', thresholdHour: 'hour',
} as const;

/** トップレベルで受け付ける単一値 */
const SCALAR_FIELDS = {
  taxRate: 'rate',
  initialNoOrderTaxRate: 'rate',
  dohanFee: 'yen',
  additionalNominationFee: 'yen',
  // closingHour は**入っていない**。閉店時刻はラストオーダーの案内には効くが、
  // テスト伝票の合計金額を動かさない＝人が承認する材料が出ない。
  // 制約 (1) に照らして AI の対象外とし、画面で編集する（この判断は
  // pos-config-schema.test.ts の対応表テストが機械的に守っている）。
} as const satisfies Record<string, FieldKind>;

/** 客層別料金のグループ（すべて `CustomerTypePricing`） */
const PRICING_GROUPS = ['initialPricing', 'rWithinPricing', 'rAfterPricing'] as const;

/**
 * AI が書ける項目の一覧（画面とプロンプトの両方で使う単一ソース）。
 * ここに無いキーは提案されても捨てる。
 */
export const WRITABLE_FIELDS: string[] = [
  ...Object.keys(SCALAR_FIELDS),
  ...PRICING_GROUPS.flatMap((g) => CUSTOMER_PRICING_KEYS.map((k) => `${g}.${k}`)),
  ...Object.keys(REGULAR_PRICING_KEYS).map((k) => `regularPricing.${k}`),
];

/** 現場向けの項目名（却下理由やプロンプトで使う） */
export const FIELD_LABELS: Record<string, string> = {
  taxRate: '税・サービス料',
  initialNoOrderTaxRate: '初回0オーダー時の税率',
  dohanFee: '同伴料',
  additionalNominationFee: '複数指名料（1人あたり）',
  closingHour: '閉店時刻',
  initialPricing: '初回料金',
  rWithinPricing: 'R内料金',
  rAfterPricing: 'R後料金',
  regularPricing: '通常料金',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * AI 出力（任意の JSON）を検証して、現行 config に重ねられるパッチにする。
 *
 * `current` は「変化があった項目だけを採用する」ために使う。モデルは指示していない
 * 項目も現状のまま列挙して返すことが多く、それを全部 accepted に載せると
 * 「7 項目変更されます」と出たのに金額が 1 円も動かない、という表示になる。
 */
export function validateConfigPatch(raw: unknown, current: StoreConfig): ValidatedConfigPatch {
  const patch: Partial<StoreConfig> = {};
  const accepted: string[] = [];
  const rejected: RejectedField[] = [];

  if (!isPlainObject(raw)) {
    return { patch, accepted, rejected: [{ path: '(全体)', reason: 'JSON オブジェクトとして読めませんでした' }] };
  }

  const take = (path: string, value: unknown, kind: FieldKind, currentValue: number): number | null => {
    if (!CHECK[kind](value)) {
      rejected.push({ path, reason: `${KIND_LABEL[kind]} で指定してください（受け取った値: ${JSON.stringify(value)}）` });
      return null;
    }
    const v = value as number;
    if (v === currentValue) return null; // 変化なし＝採用も却下もしない（数えると「変わる」と嘘になる）
    accepted.push(path);
    return v;
  };

  for (const [key, value] of Object.entries(raw)) {
    // ── 単一値 ──
    if (key in SCALAR_FIELDS) {
      const kind = SCALAR_FIELDS[key as keyof typeof SCALAR_FIELDS];
      const v = take(key, value, kind, current[key as keyof typeof SCALAR_FIELDS] as number);
      if (v !== null) (patch as Record<string, unknown>)[key] = v;
      continue;
    }

    // ── 客層別料金（初回 / R内 / R後）──
    if ((PRICING_GROUPS as readonly string[]).includes(key)) {
      if (!isPlainObject(value)) {
        rejected.push({ path: key, reason: '料金の組（set / ext / nom / tc）として読めませんでした' });
        continue;
      }
      const group = key as (typeof PRICING_GROUPS)[number];
      const cur = current[group];
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) {
        if (!(CUSTOMER_PRICING_KEYS as readonly string[]).includes(k)) {
          rejected.push({ path: `${key}.${k}`, reason: 'この項目は AI では変更できません（画面で編集してください）' });
          continue;
        }
        const taken = take(`${key}.${k}`, v, 'yen', cur[k as (typeof CUSTOMER_PRICING_KEYS)[number]]);
        if (taken !== null) next[k] = taken;
      }
      if (Object.keys(next).length > 0) {
        // 部分更新なので現行を土台に重ねる（言及されなかった項目を消さない）
        (patch as Record<string, unknown>)[group] = { ...cur, ...next };
      }
      continue;
    }

    // ── 通常料金 ──
    if (key === 'regularPricing') {
      if (!isPlainObject(value)) {
        rejected.push({ path: key, reason: '通常料金の組として読めませんでした' });
        continue;
      }
      const cur = current.regularPricing;
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) {
        const kind = REGULAR_PRICING_KEYS[k as keyof typeof REGULAR_PRICING_KEYS];
        if (!kind) {
          rejected.push({ path: `regularPricing.${k}`, reason: 'この項目は AI では変更できません（画面で編集してください）' });
          continue;
        }
        const taken = take(`regularPricing.${k}`, v, kind, cur[k as keyof typeof REGULAR_PRICING_KEYS]);
        if (taken !== null) next[k] = taken;
      }
      if (Object.keys(next).length > 0) {
        (patch as Record<string, unknown>).regularPricing = { ...cur, ...next };
      }
      continue;
    }

    // ── 対象外 ──
    // メニュー・卓名・半額ルール等は**テスト伝票プレビューに金額として現れない**ため、
    // 人が承認する材料が無い。無言で捨てず、対象外だと伝える
    rejected.push({ path: key, reason: 'この項目は AI では変更できません（プレビューで金額を確かめられないため）' });
  }

  return { patch, accepted, rejected };
}

/** 採用項目を現場の言葉に直す（画面表示用） */
export function describeField(path: string): string {
  const [head, tail] = path.split('.');
  const group = FIELD_LABELS[head] ?? head;
  if (!tail) return group;
  const leaf: Record<string, string> = {
    set: 'セット', ext: '延長', nom: '指名', tc: 'T.C',
    earlySet: '早セット', lateSet: '遅セット', thresholdHour: '早/遅の境界時刻',
  };
  return `${group}・${leaf[tail] ?? tail}`;
}
