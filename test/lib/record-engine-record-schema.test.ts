import { describe, it, expect } from 'vitest';
import { stripComments } from '../helpers/strip-comments';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  parseRecordSchema, validateXMap, isAggregatable,
  MAX_OPTIONS, MAX_ROLES, MAX_LABEL_LENGTH,
  FIELD_KEY_PATTERN, MAX_X_KEYS, MAX_STRING_LENGTH, MAX_TAGS, MAX_FIELDS, OPAQUE,
} from '@/lib/record-engine/record-schema';

// 記録エンジン段 5（P149）。**rules はマップのキーを 1 つずつ検査できない**ので、
// ⚠️ **ここは「唯一の番人」では*ない***（P154-PM4 で実測して訂正）。iOS は `x.<key>` で
// Firestore へ直接書き、Web の本番呼び出し元は 0 件。**各書き手が自分の写しで守っている**。
// このファイルの役割は「関門」ではなく**仕様の実装＋各写しの照合先**。
// ⚠️ **ただし番人なのは*値*についてだけ**（P153-PM3）。ここに並ぶのは「書こうとしている値」の
// 検査だけで、**差分の組み立て（とくに削除）はこの関数を一度も通らない**。
// 消える経路は書き手側の約束（record-schema.ts 冒頭の 4〜6）で塞ぐ。

describe('parseRecordSchema — 壊れた項目は落とすが doc 全体は捨てない', () => {
  it('正しい項目を読む', () => {
    const { schema, rejected } = parseRecordSchema({
      fields: [{ key: 'bottle_count', type: 'count', label: 'ボトル本数', roles: ['bottle'] }],
    });
    expect(schema.fields).toHaveLength(1);
    expect(schema.fields[0]).toMatchObject({ key: 'bottle_count', type: 'count', roles: ['bottle'] });
    expect(rejected).toEqual([]);
  });

  // 1 項目の不正で店の全項目が消えると、記録画面が丸ごと使えなくなる
  it('壊れた項目だけ落として残りは通す', () => {
    const { schema, rejected } = parseRecordSchema({
      fields: [{ key: 'ok_field', type: 'count', label: 'A', roles: [] }, null, { key: 'ボトル' }, 42],
    });
    expect(schema.fields.map((f) => f.key)).toEqual(['ok_field']);
    expect(rejected).toHaveLength(3);
  });

  it('fields が無い・配列でない・null でも落ちない', () => {
    for (const raw of [null, undefined, {}, { fields: 'x' }, 42]) {
      expect(parseRecordSchema(raw).schema.fields).toEqual([]);
    }
  });

  describe('キーの形（改名で集計が割れるのを構造的に防ぐ）', () => {
    it('正しいキーは通る', () => {
      for (const key of ['a', 'bottle_count', 'x1', 'a'.repeat(40)]) {
        expect(FIELD_KEY_PATTERN.test(key), key).toBe(true);
      }
    });

    // 表示名がそのままキーになると、改名のたびに別項目になって集計が割れる
    it('日本語・大文字・記号・数字始まり・41 字以上は落とす', () => {
      for (const key of ['ボトル本数', 'Bottle', 'a-b', 'a b', '1a', '_a', '', 'a'.repeat(41)]) {
        const { schema, rejected } = parseRecordSchema({ fields: [{ key, type: 'count', label: 'x' }] });
        expect(schema.fields, key).toEqual([]);
        expect(rejected[0].reason).toContain('キー');
      }
    });

    it('キーの重複は後勝ちにせず落とす', () => {
      const { schema, rejected } = parseRecordSchema({
        fields: [{ key: 'a', type: 'count', label: '1' }, { key: 'a', type: 'money', label: '2' }],
      });
      expect(schema.fields).toHaveLength(1);
      expect(schema.fields[0].label).toBe('1');
      expect(rejected[0].reason).toBe('キーが重複しています');
    });
  });

  describe('未知の型は拒否せず opaque にする（§1.6）', () => {
    // 拒否すると、新しい型を使う別クライアントの記録がこちらで丸ごと読めなくなる
    it('知らない型は opaque になる', () => {
      const { schema } = parseRecordSchema({ fields: [{ key: 'k', type: 'geo', label: 'x' }] });
      expect(schema.fields[0].type).toBe(OPAQUE);
    });

    it('型が無い・型でない場合も opaque', () => {
      for (const type of [undefined, null, 42, {}]) {
        const { schema } = parseRecordSchema({ fields: [{ key: 'k', type, label: 'x' }] });
        expect(schema.fields[0].type, JSON.stringify(type)).toBe(OPAQUE);
      }
    });

    it('10 種の型はそのまま通る', () => {
      for (const type of ['money', 'count', 'duration', 'when', 'period', 'grade', 'category', 'tags', 'ref', 'note']) {
        const { schema } = parseRecordSchema({ fields: [{ key: 'k', type, label: 'x' }] });
        expect(schema.fields[0].type, type).toBe(type);
      }
    });
  });

  it('label が無ければキーで代用する（画面が空欄にならない）', () => {
    const { schema } = parseRecordSchema({ fields: [{ key: 'bottle_count', type: 'count' }] });
    expect(schema.fields[0].label).toBe('bottle_count');
  });

  it('付随情報（options / direction / scale / target / scope）を読む', () => {
    const { schema } = parseRecordSchema({
      fields: [{
        key: 'k', type: 'ref', label: 'x', roles: ['a'],
        options: ['A', 'B', 42], direction: 'out', scale: 5, target: 'customers', scope: 'shop',
      }],
    });
    expect(schema.fields[0]).toMatchObject({
      options: ['A', 'B'], direction: 'out', scale: 5, target: 'customers', scope: 'shop',
    });
  });

  it('不正な付随情報は落とす（既定に倒さない）', () => {
    const { schema } = parseRecordSchema({
      fields: [{ key: 'k', type: 'grade', label: 'x', direction: 'sideways', scale: 1, scope: 'galaxy' }],
    });
    expect(schema.fields[0]).not.toHaveProperty('direction');
    expect(schema.fields[0]).not.toHaveProperty('scale'); // scale=1 は段階として成立しない
    expect(schema.fields[0]).not.toHaveProperty('scope');
  });

  it(`項目は ${MAX_FIELDS} 個で打ち切る`, () => {
    const many = Array.from({ length: MAX_FIELDS + 5 }, (_, i) => ({ key: `f${i}`, type: 'count', label: 'x' }));
    const { schema, rejected } = parseRecordSchema({ fields: many });
    expect(schema.fields).toHaveLength(MAX_FIELDS);
    expect(rejected).toHaveLength(5);
  });

  it('ir_version は保持し、欠落なら付けない（遡って刻まない）', () => {
    expect(parseRecordSchema({ fields: [], ir_version: 2 }).schema.ir_version).toBe(2);
    expect(parseRecordSchema({ fields: [] }).schema).not.toHaveProperty('ir_version');
  });
});

describe('validateXMap — 未知キーは落とさない（§1.6）', () => {
  // 読み込み→保存の往復で、別クライアントの新機能が書いた項目を消してしまう
  it('スキーマに無いキーも保持する', () => {
    const { x, rejected } = validateXMap({ unknown_field: 'なにか' }, { fields: [] });
    expect(x).toEqual({ unknown_field: 'なにか' });
    expect(rejected).toEqual([]);
  });

  it('スキーマを渡さなくても動く（オフライン保存で書けなくなる方が害が大きい）', () => {
    expect(validateXMap({ a: 1 }).x).toEqual({ a: 1 });
  });

  it('マップでない入力は空を返す（落ちない）', () => {
    for (const raw of [null, undefined, 'x', 42, [1, 2]]) {
      expect(validateXMap(raw).x).toEqual({});
    }
  });

  describe('保存すると壊れるものだけ落とす', () => {
    // NaN が 1 個混ざるだけで合計が全部 NaN になる。Firestore は保存できてしまう
    it('NaN / Infinity は落とす', () => {
      const { x, rejected } = validateXMap({ a: NaN, b: Infinity, c: -Infinity, d: 5 });
      expect(x).toEqual({ d: 5 });
      expect(rejected).toHaveLength(3);
      expect(rejected[0].reason).toContain('有限');
    });

    it('キー名の形が不正なものは落とす（未知でも通さない唯一の条件）', () => {
      const { x, rejected } = validateXMap({ 'ボトル': 1, 'A-B': 2, ok_key: 3 });
      expect(x).toEqual({ ok_key: 3 });
      expect(rejected).toHaveLength(2);
    });

    it(`キーは ${MAX_X_KEYS} 個で打ち切る`, () => {
      const many = Object.fromEntries(Array.from({ length: MAX_X_KEYS + 5 }, (_, i) => [`f${i}`, i]));
      const { x, rejected } = validateXMap(many);
      expect(Object.keys(x)).toHaveLength(MAX_X_KEYS);
      expect(rejected).toHaveLength(5);
    });

    it('長すぎる文字列は切り詰める（捨てない）', () => {
      const { x } = validateXMap({ memo: 'あ'.repeat(MAX_STRING_LENGTH + 100) });
      expect((x.memo as string).length).toBe(MAX_STRING_LENGTH);
    });

    it('入れ子のマップは拒否する（period 以外）', () => {
      const { x, rejected } = validateXMap({ deep: { a: 1 } });
      expect(x).toEqual({});
      expect(rejected[0].reason).toContain('入れ子');
    });

    it('null / undefined は null として保持する（欠落と区別する）', () => {
      expect(validateXMap({ a: null, b: undefined }).x).toEqual({ a: null, b: null });
    });
  });

  describe('配列（tags 想定）', () => {
    it(`文字列配列は ${MAX_TAGS} 件まで通る`, () => {
      const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`);
      expect((validateXMap({ tags: many }).x.tags as string[])).toHaveLength(MAX_TAGS);
    });

    it('文字列以外が混ざった配列は落とす（黙って間引かない）', () => {
      const { x, rejected } = validateXMap({ tags: ['a', 42] });
      expect(x).toEqual({});
      expect(rejected[0].reason).toContain('文字列以外');
    });
  });

  describe('period だけは 1 段のマップを許す', () => {
    const schema = { fields: [{ key: 'stay', type: 'period' as const, label: '滞在', roles: [] }] };

    it('start / end を通す', () => {
      expect(validateXMap({ stay: { start: 100, end: 200 } }, schema).x.stay).toEqual({ start: 100, end: 200 });
    });

    it('片側だけでも通す（開いた期間）', () => {
      expect(validateXMap({ stay: { start: 100 } }, schema).x.stay).toEqual({ start: 100, end: null });
    });

    it('start > end は落とす（期間として成立しない）', () => {
      const { rejected } = validateXMap({ stay: { start: 200, end: 100 } }, schema);
      expect(rejected[0].reason).toContain('start が end より後');
    });

    it('数値でない start / end は落とす', () => {
      expect(validateXMap({ stay: { start: 'いつか' } }, schema).rejected).toHaveLength(1);
      expect(validateXMap({ stay: { start: NaN } }, schema).rejected).toHaveLength(1);
    });

    it('スキーマが無ければ period でも入れ子として拒否する（型が分からないため）', () => {
      expect(validateXMap({ stay: { start: 1, end: 2 } }).rejected[0].reason).toContain('入れ子');
    });
  });
});

describe('isAggregatable — opaque と note は集計に出さない（§1.2 / §1.6）', () => {
  it('通常の型は集計できる', () => {
    expect(isAggregatable({ key: 'a', type: 'count', label: 'x', roles: [] })).toBe(true);
    expect(isAggregatable({ key: 'a', type: 'money', label: 'x', roles: [] })).toBe(true);
  });

  it('opaque と note は集計しない', () => {
    expect(isAggregatable({ key: 'a', type: OPAQUE, label: 'x', roles: [] })).toBe(false);
    expect(isAggregatable({ key: 'a', type: 'note', label: 'x', roles: [] })).toBe(false);
  });

  // 保持はするが集計には出さない。「集計できません」と明示するための判定
  it('スキーマに無い項目（未知）は集計しない', () => {
    expect(isAggregatable(undefined)).toBe(false);
  });
});


// P154-PM3: yorulog の「**洗った範囲を『全部』と呼んでいた**」を受けた点検。
// P153-PM26 で `limit` を全部洗ったつもりだったが、見ていたのは**取得の limit** だけで、
// **スキーマ側の上限**は視野に入っていなかった。
//
// 上限で切ること自体は必要（doc が肥大すると全員の記録画面が開かなくなる）。
// 悪いのは**切ったことを言わずに、切った後の姿を「その項目そのもの」の顔で出す**こと。
// とくに `/api/record-engine/apply` は**読んだ姿をそのまま書き戻す**ので、
// 黙って切ると**今回の適用と無関係な項目が恒久的に削られる**。
describe('P154-PM3 スキーマ側の上限は「切った」ことを必ず言う', () => {
  const base = { key: 'k1', type: 'text', label: 'ラベル' };

  it('選択肢が上限を超えたら trimmed に載せる（採用はする）', () => {
    const options = Array.from({ length: MAX_OPTIONS + 7 }, (_, i) => `o${i}`);
    const { schema, rejected, trimmed } = parseRecordSchema({ fields: [{ ...base, type: 'select', options }] });
    expect(schema.fields[0].options).toHaveLength(MAX_OPTIONS); // 切ること自体は正しい
    expect(rejected).toEqual([]);                               // **拒否ではない**（採用している）
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].key).toBe('k1');
    expect(trimmed[0].reason).toContain('7');                   // 何個落としたかが判る
  });

  it('役割が上限を超えたら trimmed に載せる（誰に出すかが変わる）', () => {
    const roles = Array.from({ length: MAX_ROLES + 2 }, (_, i) => `r${i}`);
    const { schema, trimmed } = parseRecordSchema({ fields: [{ ...base, roles }] });
    expect(schema.fields[0].roles).toHaveLength(MAX_ROLES);
    expect(trimmed.some((t) => t.reason.includes('役割'))).toBe(true);
  });

  it('表示名・参照先の切り詰めも言う（参照先は切ると別のものを指す）', () => {
    const long = 'あ'.repeat(MAX_LABEL_LENGTH + 5);
    const { schema, trimmed } = parseRecordSchema({
      fields: [{ key: 'k1', type: 'ref', label: long, target: long }],
    });
    expect(schema.fields[0].label).toHaveLength(MAX_LABEL_LENGTH);
    expect(schema.fields[0].target).toHaveLength(MAX_LABEL_LENGTH);
    expect(trimmed).toHaveLength(2);
  });

  // ⚠️ 「上限内なら空」**だけ**を見ると、`trimmed` を**常に空で返す実装**でも通る
  //    ＝「正しく 0」と「常に 0」を区別できない（P154-PM7 で実測して判明）。
  //    同じ関数が上限超では**必ず言う**ことを対にして、初めて番人になる
  it('上限内なら trimmed は空・上限超なら必ず言う（常に空の実装を通さない）', () => {
    const within = parseRecordSchema({
      fields: [{ ...base, type: 'select', options: ['a', 'b'], roles: ['cast'] }],
    });
    expect(within.trimmed).toEqual([]);

    const over = parseRecordSchema({
      fields: [{ ...base, type: 'select', options: Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `o${i}`) }],
    });
    expect(over.trimmed.length).toBeGreaterThan(0);
  });

  it('拒否された項目は trimmed に混ざらない（別勘定＝検算が壊れない）', () => {
    const { schema, rejected, trimmed } = parseRecordSchema({
      fields: [
        { key: '9bad', type: 'text', label: 'x' },                                   // キーが不正＝拒否
        { ...base, type: 'select', options: Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `o${i}`) },
      ],
    });
    expect(schema.fields).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(trimmed).toHaveLength(1);
    expect(rejected[0].key).not.toBe(trimmed[0].key);
  });

  // ここが本丸。apply は読んだ姿を書き戻すので、黙って切ると**次の保存で本当に消える**
  it('読み→書き戻しの往復で選択肢が恒久的に減ることを固定する', () => {
    const stored = {
      fields: [{ ...base, type: 'select', options: Array.from({ length: MAX_OPTIONS + 3 }, (_, i) => `o${i}`) }],
    };
    const first = parseRecordSchema(stored);
    expect(first.trimmed).toHaveLength(1); // 1 回目は「削った」と言える

    // apply が書き戻すのはこの `schema.fields`。それを読み直すと…
    const second = parseRecordSchema({ fields: first.schema.fields });
    expect(second.schema.fields[0].options).toHaveLength(MAX_OPTIONS);
    // ⚠️ **2 回目はもう何も言わない**——既に消えているので「削った」ことすら判らなくなる。
    // だからこそ 1 回目で言う必要がある（言い逃すと二度と気づけない種類の欠損）
    expect(second.trimmed).toEqual([]);
  });
});


// 値の側（書き込み経路）。ここは黙って切ると**利用者が入れた文字がその場で消える**
describe('P154-PM3 記録の値も「切った」ことを必ず言う', () => {
  it('長すぎる文字列は保存しつつ trimmed に載せる', () => {
    const long = 'あ'.repeat(MAX_STRING_LENGTH + 12);
    const { x, rejected, trimmed } = validateXMap({ memo: long });
    expect((x.memo as string).length).toBe(MAX_STRING_LENGTH);
    expect(rejected).toEqual([]); // **拒否ではない**（保存はしている）
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].key).toBe('memo');
    expect(trimmed[0].reason).toContain('12');
  });

  it('タグが上限を超えたら落とした個数を言う', () => {
    const tags = Array.from({ length: MAX_TAGS + 4 }, (_, i) => `t${i}`);
    const { x, trimmed } = validateXMap({ tags });
    expect(x.tags).toHaveLength(MAX_TAGS);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].reason).toContain('4');
  });

  it('タグの件数と各要素の長さは別々に言う（理由を畳まない）', () => {
    const tags = [
      ...Array.from({ length: MAX_TAGS }, () => 'あ'.repeat(MAX_STRING_LENGTH + 1)),
      't-extra',
    ];
    const { trimmed } = validateXMap({ tags });
    expect(trimmed).toHaveLength(2); // 「1 個落とした」と「N 個を切った」
  });

  // 値の側も同じ。否定だけでは「常に空」を見逃す（P154-PM7）
  it('上限内なら trimmed は空・上限超なら必ず言う（常に空の実装を通さない）', () => {
    expect(validateXMap({ memo: 'ふつうの長さ', tags: ['a', 'b'], amount: 1200 }).trimmed).toEqual([]);
    expect(validateXMap({ memo: 'あ'.repeat(MAX_STRING_LENGTH + 1) }).trimmed.length).toBeGreaterThan(0);
  });

  it('文字列以外が混ざった配列は従来どおり拒否（切り詰めに化けない）', () => {
    const { x, rejected, trimmed } = validateXMap({ tags: ['a', 3] });
    expect(x.tags).toBeUndefined();
    expect(rejected).toHaveLength(1);
    expect(trimmed).toEqual([]);
  });
});


// P154-PM4: 「唯一の番人・書き手は全員ここを通す」という**申告**が、実測と食い違っていた。
// P153-PM4 は写し 4 箇所に「*値*についてだけ」という限定を足したが、
// **限定を足した本人が、限定した文の前提（そもそも全員が通っているのか）を確かめていなかった。**
//
// ここは呼び出し元を**実測で固定**する。増減したら落ちるので、そのとき
// `record-schema.ts` 冒頭の「ここは唯一の番人ではない」の段落を書き直せる
// （terminology の `lexicon-snapshot.json` と同じ「知らせ忘れに気づける」立て付け）。
describe('P154-PM4 検証関数の届く範囲を実測で固定する', () => {
  const SRC_ROOT = join(process.cwd(), 'src');

  function srcFiles(): string[] {
    const out: string[] = [];
    (function walk(d: string) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name)) out.push(f);
      }
    })(SRC_ROOT);
    return out;
  }
  /** `fn` を**呼んでいる**ファイル。定義そのもの（`export function fn(`）は数えない */
  const callersOf = (fn: string) => srcFiles()
    .filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8')).replace(new RegExp(`(export )?function ${fn}\\(`, 'g'), '');
      return new RegExp(`${fn}\\(`).test(src);
    })
    .map((f) => relative(SRC_ROOT, f).split(/[\\/]/).join('/'))
    .sort();

  it('validateXMap の本番の呼び出し元は derivation.ts だけ（＝書き手は 1 つも通っていない）', () => {
    expect(callersOf('validateXMap')).toEqual(['lib/record-engine/derivation.ts']);
  });

  it('その derivation.ts の出口（derivationsToXPatch）も本番からは呼ばれていない', () => {
    // ＝ `validateXMap` は本番コードから 1 度も実行されない。
    // 「ここを通しているから安全」と書けない根拠がこれ。
    expect(callersOf('derivationsToXPatch')).toEqual([]);
  });

  it('parseRecordSchema は逆に本番で実際に使われている（読みの側は届いている）', () => {
    const callers = callersOf('parseRecordSchema');
    expect(callers).toContain('app/api/record-engine/apply/route.ts');
    expect(callers.length).toBeGreaterThan(1);
  });

  it('「唯一の番人」という言い切りがコードベースに残っていない', () => {
    // ⚠️ この一文は**コピーされる**（P153 で 4 箇所に増えていた実績がある）。
    // 復活したら落として、実測し直させる
    // 判定は**単純な規則**にする: この一文を持ってよいのは正本（record-schema.ts）だけ。
    // ⚠️ 最初は「近くに打ち消しがあれば可」にしたが、打ち消しの書き方は無数にあり
    //    （「ではない」「通っていない」…）**判定の方がザル**になった。
    //    写しが増えることを止めたいのだから、**写しの存在そのもの**を見れば足りる。
    const CANON = 'lib/record-engine/record-schema.ts';
    const offenders = srcFiles()
      .filter((f) => /唯一の番人/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC_ROOT, f).split(/[\\/]/).join('/'))
      .filter((rel) => rel !== CANON);
    expect(offenders).toEqual([]);
  });
});
