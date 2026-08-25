import { describe, it, expect } from 'vitest';
import {
  parseRecordSchema, validateXMap, isAggregatable,
  FIELD_KEY_PATTERN, MAX_X_KEYS, MAX_STRING_LENGTH, MAX_TAGS, MAX_FIELDS, OPAQUE,
} from '@/lib/record-engine/record-schema';

// 記録エンジン段 5（P149）。**rules はマップのキーを 1 つずつ検査できない**ので、
// ここが自由項目の唯一の番人になる。書き手（Web / iOS / nomishugy / CF）は全員ここを通す。

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
