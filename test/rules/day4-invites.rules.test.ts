// Day4 メンバー招待まわりの rules テスト。
// - members の自己登録穴（誰でも任意の店に参加できた）の封鎖
// - オーナー bootstrap（店舗作成直後の自己登録）は許可
// - invites の read を owner/manager に限定（コード列挙防止）
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'owner_uid';
const CAST = 'cast_uid';
const STRANGER = 'stranger_uid';
const SHOP = 'shop1';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: 'テスト店', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST}`), { role: 'cast' });
    await setDoc(doc(db, `shop_shops/${SHOP}/invites/CODE123`), { role: 'cast', createdBy: OWNER });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('members 自己登録の封鎖', () => {
  it('部外者は自分を members に登録できない（旧: 誰でも参加できた穴）', async () => {
    await assertFails(setDoc(doc(as(STRANGER), `shop_shops/${SHOP}/members/${STRANGER}`), { role: 'manager' }));
  });
  it('部外者は自分を cast としても登録できない', async () => {
    await assertFails(setDoc(doc(as(STRANGER), `shop_shops/${SHOP}/members/${STRANGER}`), { role: 'cast' }));
  });
  it('オーナーは他人のメンバー登録/role変更ができる', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/members/new_member`), { role: 'cast' }));
  });
  it('店舗作成直後のオーナー自己登録は許可（bootstrap）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'shop_shops/shop2'), { name: '新店', ownerUid: OWNER });
    });
    await assertSucceeds(setDoc(doc(as(OWNER), 'shop_shops/shop2/members/owner_uid'), { role: 'owner' }));
  });
  it('cast は他人の role を変更できない', async () => {
    await assertFails(setDoc(doc(as(CAST), `shop_shops/${SHOP}/members/${OWNER}`), { role: 'cast' }, { merge: true }));
  });
  it('本人はメンバーから抜けられる（自主退店）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `shop_shops/${SHOP}/members/leaver`), { role: 'cast' });
    });
    await assertSucceeds(deleteDoc(doc(as('leaver'), `shop_shops/${SHOP}/members/leaver`)));
  });
});

describe('invites の閲覧制限', () => {
  it('cast は招待コード一覧を読めない（列挙→無断参加の防止）', async () => {
    await assertFails(getDocs(collection(as(CAST), `shop_shops/${SHOP}/invites`)));
  });
  it('部外者は個別コードも読めない', async () => {
    await assertFails(getDoc(doc(as(STRANGER), `shop_shops/${SHOP}/invites/CODE123`)));
  });
  it('オーナーは招待一覧を読める', async () => {
    await assertSucceeds(getDocs(collection(as(OWNER), `shop_shops/${SHOP}/invites`)));
  });
});

// 2026-08-25（yorulog からの指摘）: iOS の MembersView は招待コードを
// `Int.random(0...999_999)` の 6 桁で採番して `invites/{code}` へ書く。
// 同じ店の既存コードと衝突したとき、update が許可されていると**既存の招待を黙って上書き**し、
// 未使用コードの期限が静かにリセットされる。update を落として衝突を表に出す。
describe('invites は作成のみ（衝突を黙って上書きさせない）', () => {
  it('オーナーは新しいコードを作成できる', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/invites/NEWCODE1`), {
      role: 'cast', createdBy: OWNER,
    }));
  });

  it('オーナーでも既存コードは上書きできない（＝採番衝突が permission-denied で表に出る）', async () => {
    await assertFails(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/invites/CODE123`), {
      role: 'manager', createdBy: OWNER,
    }));
  });

  // 使用済みマークは redeem API（Admin SDK）が付ける。クライアントからは付けられない
  it('オーナーでも使用済みマークを直接は書けない', async () => {
    await assertFails(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/invites/CODE123`), {
      usedBy: CAST,
    }, { merge: true }));
  });

  it('取り消し（削除）は従来どおりできる', async () => {
    await assertSucceeds(deleteDoc(doc(as(OWNER), `shop_shops/${SHOP}/invites/NEWCODE1`)));
  });
});
