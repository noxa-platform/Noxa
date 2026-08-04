// Day100: shop_shops/{shopId}/daily_close_rows の rules テスト。
// 背景: 本コレクションは rules に未定義（＝既定 deny）で、iOS の Daily Close 画面が
// read/write/delete すべて permission-denied で 100% 失敗していた（yorulog Day67/68 の照合）。
// 設計方針（src/lib/types/index.ts の Daily Close 節）:
//   キャストは自分の行のみ閲覧可・編集は不可（異議申立は daily_close_disputes）。
//   記録は売上編集権限（owner/manager/accounting）、削除は owner/manager。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, collection, query, where,
} from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'dc_owner';
const MANAGER = 'dc_manager';
const ACCOUNTING = 'dc_accounting';
const CAST_A = 'dc_cast_a';
const CAST_B = 'dc_cast_b';
const OUTSIDER = 'dc_outsider';
const SHOP = 'shop_daily_close';

const ROW_A = 'row_of_cast_a';
const ROW_B = 'row_of_cast_b';

const seedRow = (castUid: string) => ({
  date: '2026-08-05',
  castUid,
  castName: 'テスト',
  customerName: '客',
  salesAmount: 12000,
  nominationType: 'honshimei',
  drinkBack: 0,
  bottleBack: 0,
  adjustment: 0,
  memo: '',
  createdBy: OWNER,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: '日締めの店', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${MANAGER}`), { role: 'manager' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${ACCOUNTING}`), { role: 'accounting' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST_A}`), { role: 'cast' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST_B}`), { role: 'cast' });
    await setDoc(doc(db, `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`), seedRow(CAST_A));
    await setDoc(doc(db, `shop_shops/${SHOP}/daily_close_rows/${ROW_B}`), seedRow(CAST_B));
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const rowsOf = (uid: string) => collection(as(uid), `shop_shops/${SHOP}/daily_close_rows`);

describe('daily_close_rows の閲覧（キャストは自分の行のみ）', () => {
  it('キャストは自分の行を単体取得できる（旧: rules 未定義で全 deny）', async () => {
    await assertSucceeds(getDoc(doc(as(CAST_A), `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`)));
  });
  it('キャストは他人の行を読めない', async () => {
    await assertFails(getDoc(doc(as(CAST_A), `shop_shops/${SHOP}/daily_close_rows/${ROW_B}`)));
  });
  it('キャストの一覧は castUid で絞れば通る（iOS の実クエリ形）', async () => {
    await assertSucceeds(getDocs(query(rowsOf(CAST_A), where('castUid', '==', CAST_A))));
  });
  it('キャストの無絞り一覧は拒否（店の全数字を読ませない）', async () => {
    await assertFails(getDocs(rowsOf(CAST_A)));
  });
  it('キャストは他人の castUid で絞った一覧も読めない', async () => {
    await assertFails(getDocs(query(rowsOf(CAST_A), where('castUid', '==', CAST_B))));
  });
  it('owner/manager/accounting は全行を一覧できる（管理画面）', async () => {
    await assertSucceeds(getDocs(rowsOf(OWNER)));
    await assertSucceeds(getDocs(rowsOf(MANAGER)));
    await assertSucceeds(getDocs(rowsOf(ACCOUNTING)));
  });
  it('部外者は自分名義に見せかけても読めない', async () => {
    await assertFails(getDoc(doc(as(OUTSIDER), `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`)));
    await assertFails(getDocs(query(rowsOf(OUTSIDER), where('castUid', '==', OUTSIDER))));
  });
});

describe('daily_close_rows の記録（売上編集権限のみ）', () => {
  it('accounting は行を作成できる', async () => {
    await assertSucceeds(addDoc(rowsOf(ACCOUNTING), seedRow(CAST_A)));
  });
  it('manager は既存行を更新できる', async () => {
    await assertSucceeds(setDoc(
      doc(as(MANAGER), `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`),
      { salesAmount: 20000 }, { merge: true },
    ));
  });
  it('キャストは自分の行でも金額を書き換えられない（異議申立のみ可の設計）', async () => {
    await assertFails(setDoc(
      doc(as(CAST_A), `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`),
      { salesAmount: 999999 }, { merge: true },
    ));
  });
  it('キャストは自分名義の行を新規作成できない（自己申告で数字を作らせない）', async () => {
    await assertFails(addDoc(rowsOf(CAST_A), seedRow(CAST_A)));
  });
  it('部外者は作成できない', async () => {
    await assertFails(addDoc(rowsOf(OUTSIDER), seedRow(OUTSIDER)));
  });
});

describe('daily_close_rows の削除（owner/manager のみ）', () => {
  it('accounting は削除できない（記録はできるが消せない）', async () => {
    await assertFails(deleteDoc(doc(as(ACCOUNTING), `shop_shops/${SHOP}/daily_close_rows/${ROW_B}`)));
  });
  it('キャストは自分の行でも削除できない', async () => {
    await assertFails(deleteDoc(doc(as(CAST_A), `shop_shops/${SHOP}/daily_close_rows/${ROW_A}`)));
  });
  it('owner は削除できる', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), `shop_shops/${SHOP}/daily_close_rows/${ROW_B}`)));
  });
});
