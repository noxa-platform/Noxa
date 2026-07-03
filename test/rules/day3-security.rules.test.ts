// Day3 セキュリティ修正のネガティブテスト。
// ① account_users の PII 公開 read 遮断
// ② notification_inbox の他人宛 create 禁止
// ③ noxa_posts / noxa_comments の招待済み会員ゲート
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, addDoc, collection } from 'firebase/firestore';

let env: RulesTestEnvironment;
const ME = 'me_uid';
const OTHER = 'other_uid';
const ADMIN = 'admin_uid';
const MEMBER = 'member_uid'; // noxa_users に doc がある（招待済み）

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `account_users/${ME}`), { displayName: '自分', lineLoginUserId: 'LINE_PII', platformRole: 'user' });
    await setDoc(doc(db, `account_users/${ADMIN}`), { platformRole: 'admin' });
    await setDoc(doc(db, `noxa_users/${MEMBER}`), { invitedBy: 'x', inviteCredits: 5 });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('① account_users PII 遮断', () => {
  it('匿名は他人の account_users を読めない', async () => {
    await assertFails(getDoc(doc(anon(), `account_users/${ME}`)));
  });
  it('他人の account_users を読めない（PII 遮断）', async () => {
    await assertFails(getDoc(doc(as(OTHER), `account_users/${ME}`)));
  });
  it('本人は読める', async () => {
    await assertSucceeds(getDoc(doc(as(ME), `account_users/${ME}`)));
  });
  it('admin は読める', async () => {
    await assertSucceeds(getDoc(doc(as(ADMIN), `account_users/${ME}`)));
  });
});

describe('② notification_inbox 偽通知防止', () => {
  it('他人宛の通知は作成できない', async () => {
    await assertFails(addDoc(collection(as(OTHER), 'notification_inbox'), {
      userId: ME, title: '偽当選通知', body: 'このリンクをクリック', createdAt: new Date(),
    }));
  });
  it('本人宛なら作成できる', async () => {
    await assertSucceeds(addDoc(collection(as(ME), 'notification_inbox'), {
      userId: ME, title: 'メモ', body: '自分宛', createdAt: new Date(),
    }));
  });
});

describe('③ noxa_posts / noxa_comments 招待ゲート', () => {
  const validPost = (uid: string) => ({
    authorUid: uid, likeCount: 0, commentCount: 0, official: false,
    body: 'テスト投稿', createdAt: new Date(),
  });
  const validComment = (uid: string) => ({
    authorUid: uid, likeCount: 0, body: 'テストレス', createdAt: new Date(),
  });

  it('未招待ユーザーは投稿できない', async () => {
    await assertFails(addDoc(collection(as(OTHER), 'noxa_posts'), validPost(OTHER)));
  });
  it('招待済み会員は投稿できる', async () => {
    await assertSucceeds(addDoc(collection(as(MEMBER), 'noxa_posts'), validPost(MEMBER)));
  });
  it('admin は noxa_users 無しでも投稿できる', async () => {
    await assertSucceeds(addDoc(collection(as(ADMIN), 'noxa_posts'), validPost(ADMIN)));
  });
  it('未招待ユーザーはレスできない', async () => {
    await assertFails(addDoc(collection(as(OTHER), 'noxa_comments'), validComment(OTHER)));
  });
  it('招待済み会員はレスできる', async () => {
    await assertSucceeds(addDoc(collection(as(MEMBER), 'noxa_comments'), validComment(MEMBER)));
  });
});
