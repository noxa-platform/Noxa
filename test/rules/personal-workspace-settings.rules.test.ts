// 個人ワークスペース（MyDeck）設定の置き場の rules テスト（2026-08-25・ユーザー決定）。
//
// 背景: fetchMyWorkspaces は個人ユーザーに docID == uid の MyDeck を必ず足すが、
// shop_shops/{uid} の実体は無い。一方で設定はすべて shop_shops/{workspaceId} への
// updateData / getDocument なので、個人ユーザーは目標・AI 学習の opt-out・よく行く場所・
// 来店種別の追加が**どれも保存できなかった**（読みは isShopMember で拒否、書きは not-found）。
// yorulog セッションからの報告（同セッションは iOS 側に症状表示ガードを入れて待機中）。
//
// 決定: 個人設定は account_users/{uid}/settings/{settingId} に置く。
// shop_shops/{uid} の実体を作る案は、Web の useShopContext で hasShop が true になり
// 個人ユーザーに店舗 UI が出てしまう副作用があるため採らない。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const ME = 'pws_me';
const OTHER = 'pws_other';
const SETTINGS = `account_users/${ME}/settings/workspace`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `account_users/${ME}`), { handle: 'me', platformRole: 'user' });
    await setDoc(doc(db, `account_users/${OTHER}`), { handle: 'other', platformRole: 'user' });
    await setDoc(doc(db, SETTINGS), { monthlyGoal: 300000, customVisitTypes: ['同伴'] });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('本人は個人ワークスペース設定を読み書きできる（旧: 保存先が無く全滅）', () => {
  it('read できる', async () => {
    await assertSucceeds(getDoc(doc(as(ME), SETTINGS)));
  });
  it('目標を更新できる', async () => {
    await assertSucceeds(updateDoc(doc(as(ME), SETTINGS), { monthlyGoal: 500000 }));
  });
  it('来店種別・よく行く場所を追加できる', async () => {
    await assertSucceeds(updateDoc(doc(as(ME), SETTINGS), {
      customVisitTypes: ['同伴', 'アフター'],
      customPlaces: [{ name: '焼肉店', tags: ['焼肉', '同伴'] }],
    }));
  });
  // AI 学習の opt-out はプライバシー設定なので、保存できないと機能として成立しない
  it('AI 学習の opt-out を保存できる', async () => {
    await assertSucceeds(updateDoc(doc(as(ME), SETTINGS), { aiLearningOptOut: true }));
  });
  it('未作成の settings doc を新規作成できる', async () => {
    await assertSucceeds(setDoc(doc(as(ME), `account_users/${ME}/settings/other`), { x: 1 }));
  });
  it('削除もできる', async () => {
    await assertSucceeds(deleteDoc(doc(as(ME), `account_users/${ME}/settings/other`)));
  });
});

describe('他人の個人設定には一切触れない', () => {
  it('他人の設定は読めない', async () => {
    await assertFails(getDoc(doc(as(OTHER), SETTINGS)));
  });
  it('他人の設定は書けない', async () => {
    await assertFails(updateDoc(doc(as(OTHER), SETTINGS), { monthlyGoal: 1 }));
  });
  it('他人の設定は消せない', async () => {
    await assertFails(deleteDoc(doc(as(OTHER), SETTINGS)));
  });
  it('未認証は読めない', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), SETTINGS)));
  });
});

// 設定を別 doc にした理由の番人。親 doc は PII（lineLoginUserId / platformRole）を持つので、
// 設定の保存が親のフィールドを巻き込む形にしない。
describe('親の account_users doc の保護は変わらない', () => {
  it('本人でも platformRole は書き換えられない', async () => {
    await assertFails(updateDoc(doc(as(ME), `account_users/${ME}`), { platformRole: 'admin' }));
  });
  it('他人の account_users は読めない', async () => {
    await assertFails(getDoc(doc(as(OTHER), `account_users/${ME}`)));
  });
});
