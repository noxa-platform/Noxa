// Day6: POS 会計の権限整合（全ロールで会計が通る）の rules テスト。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, addDoc, deleteDoc, collection } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'owner_uid';
const CAST_A = 'cast_a';
const CAST_B = 'cast_b';
const OUTSIDER = 'outsider';
const SHOP = 'shop_sales';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: '店', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST_A}`), { role: 'cast' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST_B}`), { role: 'cast' });
    await setDoc(doc(db, `shop_shops/${SHOP}/sales/sale_b`), { amount: 10000, castUid: CAST_B, dayKey: '2026-07-03' });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('sales の役割ベース権限（POS会計の現場詰まり解消）', () => {
  it('一般キャストが他人担当（castUid=別人）の会計を登録できる', async () => {
    await assertSucceeds(addDoc(collection(as(CAST_A), `shop_shops/${SHOP}/sales`), {
      amount: 15000, castUid: CAST_B, operatorUid: CAST_A, dayKey: '2026-07-03', source: 'pos',
    }));
  });
  it('一般キャストが他人の売上を修正（取消）できる', async () => {
    await assertSucceeds(setDoc(doc(as(CAST_A), `shop_shops/${SHOP}/sales/sale_b`), { voided: true }, { merge: true }));
  });
  it('部外者は売上を登録できない', async () => {
    await assertFails(addDoc(collection(as(OUTSIDER), `shop_shops/${SHOP}/sales`), {
      amount: 1, castUid: OUTSIDER, dayKey: '2026-07-03',
    }));
  });
  it('削除は owner/manager のみ（キャスト不可）', async () => {
    await assertFails(deleteDoc(doc(as(CAST_A), `shop_shops/${SHOP}/sales/sale_b`)));
    await assertSucceeds(deleteDoc(doc(as(OWNER), `shop_shops/${SHOP}/sales/sale_b`)));
  });
});
