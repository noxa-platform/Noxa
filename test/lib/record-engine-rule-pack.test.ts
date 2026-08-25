import { describe, it, expect } from 'vitest';
import {
  validateRulePack, applyRulePack, revertRulePack, referencedFields,
  MAX_PACK_FIELDS, MAX_PACK_DERIVATIONS,
  type RulePack, type ApplyReceipt,
} from '@/lib/record-engine/rule-pack';
import type { RecordSchema } from '@/lib/record-engine/record-schema';
import type { Expr } from '@/lib/record-engine/derivation';

// 記録エンジン段 7（P151）。AI がルールパックを生成し、**人が選んだものだけ**を適用する。
//
// 取り消しの決まり（yorulog と合意）:
//   - **「AI が足した分だけを引く」**。スナップショット復元にしない
//     （間に人が手で足した分まで巻き戻り、**人が意図的に消した項目が復活する**）
//   - **間にユーザーが編集した項目は引かない**（編集を捨てることになる）
//   - 引かなかったものは理由付きで返す（画面に出す）

const emptySchema: RecordSchema = { fields: [] };
const mul: Expr = { op: '*', args: [{ field: 'unit_price' }, { field: 'bottle_count' }] };

const packRaw = {
  fields: [
    { key: 'bottle_count', type: 'count', label: 'ボトル本数', roles: ['bottle'], reason: 'シャンパンを推しているため' },
    { key: 'unit_price', type: 'money', label: '単価', roles: [], reason: '本数から売上を出すため' },
  ],
  derivations: [
    { key: 'bottle_sales', label: 'ボトル売上', expr: mul, reason: '単価と本数から自動で出す' },
  ],
};

describe('validateRulePack — AI の生成物を信用しない', () => {
  it('正しいパックは通る', () => {
    const r = validateRulePack(packRaw, emptySchema);
    expect(r.accepted).toBe(3);
    expect(r.pack.fields.map((f) => f.key)).toEqual(['bottle_count', 'unit_price']);
    expect(r.pack.derivations[0].key).toBe('bottle_sales');
    expect(r.rejected).toEqual([]);
  });

  it('壊れた入力でも落ちない', () => {
    for (const raw of [null, undefined, 'x', 42, []]) {
      expect(validateRulePack(raw, emptySchema).accepted).toBe(0);
    }
  });

  it('既存の項目・導出と同じキーは落とす（追加のみ）', () => {
    const current: RecordSchema = { fields: [{ key: 'bottle_count', type: 'count', label: '既存', roles: [] }] };
    const r = validateRulePack(packRaw, current, ['bottle_sales']);
    expect(r.pack.fields.map((f) => f.key)).toEqual(['unit_price']);
    expect(r.pack.derivations).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toContain('既にある項目です');
  });

  it('キーの形が不正な項目は落とす（段 5 の検証を再利用）', () => {
    const r = validateRulePack({ fields: [{ key: 'ボトル本数', type: 'count', label: 'x', reason: 'y' }] }, emptySchema);
    expect(r.pack.fields).toEqual([]);
    expect(r.rejected[0].reason).toContain('キー');
  });

  it('理由の無い提案は落とす', () => {
    const r = validateRulePack({
      fields: [{ key: 'a', type: 'count', label: 'A' }],
      derivations: [{ key: 'b', label: 'B', expr: { lit: 1 } }],
    }, emptySchema);
    expect(r.accepted).toBe(0);
    expect(r.rejected).toHaveLength(2);
    for (const x of r.rejected) expect(x.reason).toContain('理由');
  });

  describe('式は段 6 の検証を必ず通す（壊れた式を保存させない）', () => {
    it('不正な式は落とし、どこで落ちたかを返す', () => {
      const r = validateRulePack({
        derivations: [{ key: 'bad', label: 'B', expr: { op: '**', args: [{ lit: 1 }, { lit: 2 }] }, reason: 'x' }],
      }, emptySchema);
      expect(r.pack.derivations).toEqual([]);
      // 式のどこで落ちたかが入る（段 7 の差分プレビューで指し示せる）
      expect(r.rejected[0].reason).toContain('root.op');
      expect(r.rejected[0].reason).toContain('知らない演算子');
    });

    // 適用しても永久に null を返す式を保存させない
    it('存在しない項目を参照する式は落とす', () => {
      const r = validateRulePack({
        derivations: [{ key: 'x1', label: 'X', expr: { field: 'nope' }, reason: 'y' }],
      }, emptySchema);
      expect(r.pack.derivations).toEqual([]);
      expect(r.rejected[0].reason).toContain('nope');
    });

    // 新項目から新しい合計を作るのが本来の用途なので、ここは通す必要がある
    it('同じパックで足す項目は参照してよい', () => {
      const r = validateRulePack(packRaw, emptySchema);
      expect(r.pack.derivations).toHaveLength(1);
    });

    it('既存の項目も参照してよい', () => {
      const current: RecordSchema = { fields: [{ key: 'sales', type: 'money', label: '売上', roles: [] }] };
      const r = validateRulePack({
        derivations: [{ key: 'half', label: '半分', expr: { op: '/', args: [{ field: 'sales' }, { lit: 2 }] }, reason: 'x' }],
      }, current);
      expect(r.pack.derivations).toHaveLength(1);
    });
  });

  it('件数の上限を超えた分は理由つきで落とす', () => {
    const many = Array.from({ length: MAX_PACK_FIELDS + 3 }, (_, i) => ({
      key: `f${i}`, type: 'count', label: `F${i}`, reason: 'x',
    }));
    const manyD = Array.from({ length: MAX_PACK_DERIVATIONS + 2 }, (_, i) => ({
      key: `d${i}`, label: `D${i}`, expr: { lit: 1 }, reason: 'x',
    }));
    const r = validateRulePack({ fields: many, derivations: manyD }, emptySchema);
    expect(r.pack.fields).toHaveLength(MAX_PACK_FIELDS);
    expect(r.pack.derivations).toHaveLength(MAX_PACK_DERIVATIONS);
    expect(r.rejected).toHaveLength(5);
  });

  it('同じキーの重複提案は落とす', () => {
    const r = validateRulePack({
      fields: [
        { key: 'a', type: 'count', label: 'A', reason: 'x' },
        { key: 'a', type: 'money', label: 'A2', reason: 'y' },
      ],
    }, emptySchema);
    expect(r.pack.fields).toHaveLength(1);
    expect(r.rejected[0].reason).toBe('同じ提案が重複しています');
  });
});

describe('referencedFields', () => {
  it('入れ子の式から全部集める（重複は 1 回）', () => {
    const e: Expr = {
      if: { cmp: '>', args: [{ field: 'a' }, { lit: 1 }] },
      then: { op: '+', args: [{ field: 'b' }, { field: 'a' }] },
      else: { coalesce: [{ field: 'c' }, { lit: 0 }] },
    };
    expect(referencedFields(e).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('applyRulePack — 選ばれたものだけ適用する', () => {
  const pack: RulePack = validateRulePack(packRaw, emptySchema).pack;
  const opts = { token: 't1', now: 1000 };

  it('全部適用すると控えに足したものが載る', () => {
    const r = applyRulePack(emptySchema, [], pack, opts);
    expect(r.schema.fields.map((f) => f.key)).toEqual(['bottle_count', 'unit_price']);
    expect(r.derivations.map((d) => d.key)).toEqual(['bottle_sales']);
    expect(r.receipt).toMatchObject({ token: 't1', appliedAt: 1000 });
    expect(r.receipt.fields).toHaveLength(2);
    expect(r.receipt.derivations).toHaveLength(1);
  });

  it('選ばれていないものは触らない', () => {
    const r = applyRulePack(emptySchema, [], pack, { ...opts, selectedKeys: ['bottle_count'] });
    expect(r.schema.fields.map((f) => f.key)).toEqual(['bottle_count']);
    expect(r.derivations).toEqual([]);
    expect(r.receipt.fields).toHaveLength(1);
  });

  it('提案の reason は保存する項目定義に含めない（説明であって定義ではない）', () => {
    const r = applyRulePack(emptySchema, [], pack, opts);
    expect(r.schema.fields[0]).not.toHaveProperty('reason');
    expect(r.receipt.fields[0]).not.toHaveProperty('reason');
  });

  // 生成から適用までの間に別の人が同じキーを足しているケース
  it('適用時点で既にあるキーは飛ばして理由を返す', () => {
    const current: RecordSchema = { fields: [{ key: 'unit_price', type: 'money', label: '既存', roles: [] }] };
    const r = applyRulePack(current, [], pack, opts);
    expect(r.schema.fields.map((f) => f.key)).toEqual(['unit_price', 'bottle_count']);
    expect(r.skipped[0]).toMatchObject({ key: 'unit_price', reason: '適用しようとした時点で既にありました' });
    // 控えにも載せない（＝取り消しで他人の項目を消さない）
    expect(r.receipt.fields.map((f) => f.key)).toEqual(['bottle_count']);
  });

  it('入力を書き換えない', () => {
    const current: RecordSchema = { fields: [] };
    applyRulePack(current, [], pack, opts);
    expect(current.fields).toEqual([]);
  });
});

describe('revertRulePack — AI が足した分だけを引く', () => {
  const pack: RulePack = validateRulePack(packRaw, emptySchema).pack;
  const applied = applyRulePack(emptySchema, [], pack, { token: 't1', now: 1000 });

  it('そのまま取り消すと、足したものが全部消える', () => {
    const r = revertRulePack(applied.schema, applied.derivations, applied.receipt);
    expect(r.schema.fields).toEqual([]);
    expect(r.derivations).toEqual([]);
    expect(r.removed.sort()).toEqual(['bottle_count', 'bottle_sales', 'unit_price']);
    expect(r.skipped).toEqual([]);
  });

  // ここが設計の芯。間に人が足したものを巻き戻さない
  it('AI が足していない項目は残す', () => {
    const withMine: RecordSchema = {
      fields: [...applied.schema.fields, { key: 'my_field', type: 'count', label: '自分で足した', roles: [] }],
    };
    const r = revertRulePack(withMine, applied.derivations, applied.receipt);
    expect(r.schema.fields.map((f) => f.key)).toEqual(['my_field']);
  });

  // 編集された時点でそれは「その人のもの」。消すと編集を捨てる
  it('適用後に編集された項目は引かず、理由を返す', () => {
    const edited: RecordSchema = {
      fields: applied.schema.fields.map((f) => (f.key === 'bottle_count' ? { ...f, label: '本数（改）' } : f)),
    };
    const r = revertRulePack(edited, applied.derivations, applied.receipt);
    expect(r.schema.fields.map((f) => f.key)).toEqual(['bottle_count']);
    expect(r.skipped).toContainEqual({
      kind: 'field', key: 'bottle_count', reason: '適用後に編集されているため残しました',
    });
  });

  it('型や付随情報の変更も「編集された」として扱う', () => {
    const edited: RecordSchema = {
      fields: applied.schema.fields.map((f) => (f.key === 'unit_price' ? { ...f, type: 'count' as const } : f)),
    };
    const r = revertRulePack(edited, applied.derivations, applied.receipt);
    expect(r.schema.fields.map((f) => f.key)).toContain('unit_price');
  });

  it('roles の並び順が違うだけなら編集扱いにしない', () => {
    const p = validateRulePack({
      fields: [{ key: 'k', type: 'count', label: 'K', roles: ['a', 'b'], reason: 'x' }],
    }, emptySchema).pack;
    const a = applyRulePack(emptySchema, [], p, { token: 't', now: 1 });
    const reordered: RecordSchema = { fields: [{ ...a.schema.fields[0], roles: ['b', 'a'] }] };
    expect(revertRulePack(reordered, [], a.receipt).removed).toEqual(['k']);
  });

  it('既に消されていたものは飛ばして理由を返す', () => {
    const partly: RecordSchema = { fields: applied.schema.fields.filter((f) => f.key !== 'unit_price') };
    const r = revertRulePack(partly, applied.derivations, applied.receipt);
    expect(r.skipped).toContainEqual({ kind: 'field', key: 'unit_price', reason: '既に削除されていました' });
  });

  it('編集された導出も引かない', () => {
    const edited = applied.derivations.map((d) => ({ ...d, label: '売上（改）' }));
    const r = revertRulePack(applied.schema, edited, applied.receipt);
    expect(r.derivations).toHaveLength(1);
    expect(r.skipped).toContainEqual({
      kind: 'derivation', key: 'bottle_sales', reason: '適用後に編集されているため残しました',
    });
  });

  // 項目を消すと導出が永久に null を返す。壊れた式を残すより項目を残す方が害が小さい
  it('残る導出が使っている項目は消さない', () => {
    const edited = applied.derivations.map((d) => ({ ...d, label: '売上（改）' })); // 導出は残る
    const r = revertRulePack(applied.schema, edited, applied.receipt);
    expect(r.schema.fields.map((f) => f.key).sort()).toEqual(['bottle_count', 'unit_price']);
    expect(r.skipped.filter((s) => s.reason.includes('導出'))).toHaveLength(2);
    expect(r.removed).toEqual([]);
  });

  it('人が後から足した導出が使っている項目も消さない', () => {
    const mine = [...applied.derivations.filter((d) => d.key !== 'bottle_sales'), {
      key: 'my_calc', label: '自分の計算', expr: { field: 'bottle_count' } as Expr,
    }];
    const r = revertRulePack(applied.schema, mine, applied.receipt);
    expect(r.schema.fields.map((f) => f.key)).toContain('bottle_count');
    expect(r.removed).toEqual(['unit_price']);
  });

  it('控えが空なら何も起きない', () => {
    const empty: ApplyReceipt = { token: 't', appliedAt: 0, fields: [], derivations: [] };
    const r = revertRulePack(applied.schema, applied.derivations, empty);
    expect(r.schema).toEqual(applied.schema);
    expect(r.removed).toEqual([]);
  });
});
