import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../helpers/strip-comments';
import {
  recordShopId, belongsToShop, isUnscoped, filterByShop, SHOP_SCOPE_NOTE,
} from '../../src/lib/shop-scope';

// 出所（どの店の記録か）の判定（P128）。
//
// モデルA はキャストの顧客・売上の正本を個人側に置く。辞めても履歴が残るための設計で
// そこは正しいが、オーナー向けの俯瞰はその台帳を**当店の分に絞ってから**読まないと
//   - 掛け持ち先の売上が当店の成績・給与査定の材料に混ざる
//   - 本人が個人で付けた副業の売上まで混ざる
//   - **他店で作られた客の氏名・累計売上がオーナーに見える**（漏洩）
// が起きる。掛け持ちは業界の標準なので、これは例外ではなく既定の状態だった。

const src = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

describe('recordShopId / belongsToShop（出所の判定）', () => {
  it('★売上・来店ログは shopId、担当台帳は assignedFromShopId を出所とする', () => {
    expect(recordShopId({ shopId: 'shop-a' })).toBe('shop-a');
    expect(recordShopId({ assignedFromShopId: 'shop-b' })).toBe('shop-b');
  });

  it('★出所が当店だと確認できたものだけ true（掛け持ち先の記録は false）', () => {
    expect(belongsToShop({ shopId: 'shop-a' }, 'shop-a')).toBe(true);
    expect(belongsToShop({ shopId: 'shop-b' }, 'shop-a')).toBe(false);
  });

  it('★出所が無い記録は当店に数えない（個人ワークスペースの手入力売上・自分で登録した客）', () => {
    // 投影を書く CF は最初から shopId を刻んでいる。無いものは「読めなかった」のではなく
    // 店を経由していない＝本人の記録だと分かる。これを店の成績に載せない
    expect(belongsToShop({}, 'shop-a')).toBe(false);
    expect(belongsToShop(null, 'shop-a')).toBe(false);
    expect(isUnscoped({})).toBe(true);
    expect(isUnscoped({ shopId: 'shop-a' })).toBe(false);
  });

  it('★型が崩れた出所は「不明」に倒す（数値・空文字・空白のみ）', () => {
    expect(recordShopId({ shopId: 123 })).toBeNull();
    expect(recordShopId({ shopId: '' })).toBeNull();
    expect(recordShopId({ shopId: '   ' })).toBeNull();
    expect(belongsToShop({ shopId: 123 }, 'shop-a')).toBe(false);
  });

  it('★店舗が未確定（空の shopId）のときは何も通さない', () => {
    // 呼び出し側が店舗を確定できていない状態で全件が素通りすると、
    // 絞り込みを入れた意味が消える（Day123 の「出所を見ずに倒す」の再発）
    expect(belongsToShop({ shopId: 'shop-a' }, '')).toBe(false);
    expect(belongsToShop({}, '')).toBe(false);
    expect(filterByShop([{ shopId: 'shop-a' }], '  ', (x) => x)).toEqual([]);
  });

  it('shopId が優先され、両方あっても矛盾しない', () => {
    expect(recordShopId({ shopId: 'shop-a', assignedFromShopId: 'shop-a' })).toBe('shop-a');
  });

  it('filterByShop は当店由来だけを残す', () => {
    const rows = [
      { id: 1, shopId: 'shop-a' },
      { id: 2, shopId: 'shop-b' },
      { id: 3 },
      { id: 4, shopId: 'shop-a' },
    ];
    expect(filterByShop(rows, 'shop-a', (r) => r).map((r) => r.id)).toEqual([1, 4]);
  });

  it('範囲の説明文は「含まないもの」を明示する（受け手が数字の意味を読めるように）', () => {
    expect(SHOP_SCOPE_NOTE).toMatch(/当店/);
    expect(SHOP_SCOPE_NOTE).toMatch(/含み(ま)?せん/);
  });
});

// ── ガード: 個人台帳を出所抜きで読む形に戻っていないか（静的検査） ──
//
// Day122 の教訓（import の有無だけを見るガードは、判定を戻しても緑のまま素通りする）に従い、
// **その読み取りに絞り込みが掛かっているか**を式で見る。
describe('ガード: オーナー向け俯瞰は個人台帳を当店分に絞る', () => {
  it('★member-stats: 来店ログの集計に出所判定が入っている', () => {
    const s = src('src/app/api/team/member-stats/route.ts');
    // collectionGroup('logs') のループ本体に belongsToShop があること
    const loop = s.slice(s.indexOf("collectionGroup('logs')"), s.indexOf('const members = await Promise.all'));
    expect(loop).toContain('belongsToShop(d, shopId)');
  });

  it('★member-stats: 顧客なし日売（personal_sales）の集計にも出所判定が入っている', () => {
    const s = src('src/app/api/team/member-stats/route.ts');
    const tail = s.slice(s.indexOf('personal_sales/'));
    expect(tail).toContain('belongsToShop(d, shopId)');
  });

  it('★member-stats: 顧客数の count() が台帳の全件になっていない', () => {
    const s = src('src/app/api/team/member-stats/route.ts');
    const idx = s.indexOf('personal_customers/${castUid}/items');
    expect(idx).toBeGreaterThan(-1);
    // count() までの間に where が挟まっていること（全件 count に戻したら赤）
    const upToCount = s.slice(idx, s.indexOf('.count()', idx));
    expect(upToCount).toContain("where('assignedFromShopId', '==', shopId)");
  });

  it('★cast-customers: 台帳を返す前に出所で絞っている（他店の顧客名簿を出さない）', () => {
    const s = src('src/app/api/team/cast-customers/route.ts');
    const idx = s.indexOf('personal_customers/${castUid}/items');
    expect(idx).toBeGreaterThan(-1);
    const afterRead = s.slice(idx, s.indexOf('return NextResponse.json', idx));
    expect(afterRead).toContain('belongsToShop(');
  });

  it('★判定は shop-scope に一本化（route 内にインライン比較を書き足さない）', () => {
    for (const p of ['src/app/api/team/member-stats/route.ts', 'src/app/api/team/cast-customers/route.ts']) {
      const s = src(p);
      expect(s).toContain("from '@/lib/shop-scope'");
      // 出所の直接比較（d.shopId === shopId 等）を route に散らさない
      expect(s).not.toMatch(/\.\s*shopId\s*===\s*shopId/);
      expect(s).not.toMatch(/assignedFromShopId\s*===\s*shopId/);
    }
  });

  it('★集計範囲を受け手に返している（数字の意味が読めない状態にしない）', () => {
    for (const p of ['src/app/api/team/member-stats/route.ts', 'src/app/api/team/cast-customers/route.ts']) {
      expect(src(p)).toContain('SHOP_SCOPE_NOTE');
    }
    expect(src('src/components/modules/customers/CustomersClient.tsx')).toContain('SHOP_SCOPE_NOTE');
  });

  it('★CF: 既存台帳への来店転記で出所の刻印を補う（未記入のときだけ）', () => {
    const s = src('functions/src/sales-sync.ts');
    // 「既存台帳は差額のみ反映」の else 分岐だけを見る（新規作成側の刻印では緑にしない）
    const start = s.indexOf('visitCount: FieldValue.increment(prevLogged');
    expect(start).toBeGreaterThan(-1);
    const branch = s.slice(start - 600, start + 400);
    expect(branch).toContain('hasOrigin');
    // 既存の出所を無条件で上書きしない（後から来た店が既存店の顧客数を奪わない）
    expect(branch).toMatch(/hasOrigin\s*\?\s*\{\s*\}\s*:\s*\{\s*assignedFromShopId: shopId\s*\}/);
  });
});
