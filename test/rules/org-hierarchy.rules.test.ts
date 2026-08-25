// グループ（org）階層の rules テスト。記録エンジン段 4（2026-08-25）。
//
// 守りたいこと:
//  - org の正本（org_orgs / policy）はクライアントから触れない
//  - 店が自分で orgPath を書けない。書けると**系列他店の売上・顧客を覗ける**
//  - 作成時に orgPath を持ち込めない（作った瞬間に系列へ潜り込むのを防ぐ）
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'org_owner';
const CAST = 'org_cast';
const SHOP = 'shop_org_test';
const ORG = 'org_kansai';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), {
      name: '系列の店', ownerUid: OWNER, orgPath: ['jp', ORG],
    });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${CAST}`), { role: 'cast' });
    await setDoc(doc(db, `org_orgs/${ORG}`), { name: '関西エリア', parentOrgId: 'jp' });
    await setDoc(doc(db, `org_orgs/${ORG}/policy/default`), {
      roles: { manager: { seeSiblingShopSales: true } },
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('org の正本はクライアントから触れない', () => {
  it('オーナーでも org doc を読めない（表示に要る情報は店の doc へ非正規化する方針）', async () => {
    await assertFails(getDoc(doc(as(OWNER), `org_orgs/${ORG}`)));
  });
  it('オーナーでも org doc を書けない', async () => {
    await assertFails(updateDoc(doc(as(OWNER), `org_orgs/${ORG}`), { name: '乗っ取り' }));
  });
  it('オーナーでも policy を読めない', async () => {
    await assertFails(getDoc(doc(as(OWNER), `org_orgs/${ORG}/policy/default`)));
  });
  // ここが書けると、自分の役職の権限を勝手にオンにできる
  it('オーナーでも policy を書けない', async () => {
    await assertFails(setDoc(doc(as(OWNER), `org_orgs/${ORG}/policy/default`), {
      roles: { owner: { seeSiblingShopSales: true, seeSiblingShopCustomers: true } },
    }));
  });
  it('新しい org を勝手に作れない', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'org_orgs/org_new'), { name: '勝手な系列', parentOrgId: null }));
  });
});

describe('orgPath は店側から書き換えられない', () => {
  it('オーナーでも orgPath を変更できない（系列への潜り込みを防ぐ）', async () => {
    await assertFails(updateDoc(doc(as(OWNER), `shop_shops/${SHOP}`), { orgPath: ['jp', 'org_kyushu'] }));
  });

  it('orgPath を消すこともできない', async () => {
    await assertFails(updateDoc(doc(as(OWNER), `shop_shops/${SHOP}`), { orgPath: [] }));
  });

  it('他のフィールドの更新は従来どおりできる', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), `shop_shops/${SHOP}`), { name: '改名' }));
  });

  it('名前と一緒に orgPath を混ぜても弾かれる（抱き合わせを許さない）', async () => {
    await assertFails(updateDoc(doc(as(OWNER), `shop_shops/${SHOP}`), {
      name: '改名', orgPath: ['jp', 'org_kyushu'],
    }));
  });

  it('キャストはそもそも店の doc を更新できない', async () => {
    await assertFails(updateDoc(doc(as(CAST), `shop_shops/${SHOP}`), { name: '改名' }));
  });
});

describe('店の作成時に orgPath を持ち込めない', () => {
  it('orgPath 付きの新規作成は弾かれる', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'shop_shops/shop_sneak'), {
      name: '潜り込み', ownerUid: OWNER, orgPath: ['jp', ORG],
    }));
  });

  it('orgPath なしなら従来どおり作れる', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), 'shop_shops/shop_plain'), {
      name: 'ふつうの店', ownerUid: OWNER,
    }));
  });
});
