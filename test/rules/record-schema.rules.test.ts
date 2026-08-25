// 記録エンジン段 5 の rules（P149）。
//
// 固定すること:
//   - `record_schema` の置き場所（**単一 doc**）と権限: 読みは店のメンバー、書きは owner のみ
//   - 記録側の `x`（自由項目）はキー数だけ縛る。**持たない記録はそのまま通る**（既存データ全部）
//
// ⚠️ **rules で守れるのはここまで**。マップのキーを 1 つずつ検査できない（繰り返しが書けない）
// ため、**キー名の形も値の型も rules では検査できない**。それは
// `src/lib/record-engine/record-schema.ts` が唯一の番人で、書き手は全員そこを通す約束。
// この非対称は意図的なので、テストにも「rules では落ちない」ことを書いて残す。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'rs_owner';
const CAST = 'rs_cast';
const OUTSIDER = 'rs_outsider';
const SHOP = 'rs_shop';
const SCHEMA = `shop_shops/${SHOP}/settings/record_schema`;

/** キーを n 個持つ `x` を作る */
const xWith = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, i]));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: 'RS', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner', status: 'active' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST}`), { role: 'cast', status: 'active' });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('record_schema は「読みはメンバー / 書きは owner」', () => {
  const schema = { fields: [{ key: 'bottle_count', type: 'count', label: 'ボトル本数', roles: ['bottle'] }] };

  it('owner は書ける', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), SCHEMA), schema));
  });

  // 項目の形はワークスペース全体の集計の切り口。キャストが増やせると店の数字の意味が変わる
  it('キャストは書けない', async () => {
    await assertFails(setDoc(doc(as(CAST), SCHEMA), schema));
  });

  it('キャストも読める（記録画面が項目を出すのに要る）', async () => {
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(as(CAST), SCHEMA)));
  });

  it('店のメンバーでない人は読めない', async () => {
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(as(OUTSIDER), SCHEMA)));
  });
});

describe('記録側の `x` はキー数だけ縛る', () => {
  it('`x` を持たない記録はそのまま通る（既存データ全部がこれ）', async () => {
    await assertSucceeds(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_s1`), {
      amount: 1000, castUid: CAST,
    }));
  });

  it('キー 50 個までは通る', async () => {
    await assertSucceeds(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_s2`), {
      amount: 1000, x: xWith(50),
    }));
  });

  // 無制限だと 1 記録が青天井に膨らみ、一覧の読み取りが重くなって他の機能まで巻き添えになる
  it('キー 51 個は拒否される', async () => {
    await assertFails(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_s3`), {
      amount: 1000, x: xWith(51),
    }));
  });

  it('`x` がマップでなければ拒否される', async () => {
    await assertFails(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_s4`), { amount: 1, x: 'ごみ' }));
    await assertFails(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_s5`), { amount: 1, x: [1, 2] }));
  });

  it('個人の売上・顧客台帳にも同じ縛りが効く', async () => {
    await assertSucceeds(setDoc(doc(as(CAST), `personal_sales/${CAST}/items/rs_p1`), { amount: 1, x: xWith(3) }));
    await assertFails(setDoc(doc(as(CAST), `personal_sales/${CAST}/items/rs_p2`), { amount: 1, x: xWith(51) }));
    await assertSucceeds(setDoc(doc(as(CAST), `personal_customers/${CAST}/items/rs_c1`), { name: 'x', x: xWith(3) }));
    await assertFails(setDoc(doc(as(CAST), `personal_customers/${CAST}/items/rs_c2`), { name: 'x', x: xWith(51) }));
  });
});

// ここは「守れない」ことを明示的に残すためのテスト。挙動が変わったら気づけるようにする。
// これらを rules で落とせると誤解したまま検証関数を外すと、そのまま素通りする。
describe('rules では落ちないもの（検証関数が唯一の番人であることの記録）', () => {
  it('キー名の形は rules では検査できない（繰り返しが書けないため）', async () => {
    await assertSucceeds(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_bad1`), {
      amount: 1, x: { 'ボトル本数': 3, 'A-B': 1 }, // 検証関数なら弾く形
    }));
  });

  it('値の型も rules では検査できない（入れ子も通ってしまう）', async () => {
    await assertSucceeds(setDoc(doc(as(CAST), `shop_shops/${SHOP}/sales/rs_bad2`), {
      amount: 1, x: { deep: { a: { b: 1 } } },
    }));
  });
});
