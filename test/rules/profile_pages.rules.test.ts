import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'owner_uid';
const OTHER = 'other_uid';
const ADMIN = 'admin_uid';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  // 事前データ（ルール無視で投入）
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'account_users/admin_uid'), { platformRole: 'admin' });
    await setDoc(doc(db, 'profile_pages/pub'), { ownerUid: OWNER, visibility: 'public' });
    await setDoc(doc(db, 'profile_pages/unl'), { ownerUid: OWNER, visibility: 'unlisted' });
    await setDoc(doc(db, 'profile_pages/priv'), { ownerUid: OWNER, visibility: 'private' });
    await setDoc(doc(db, 'profile_pages/legacy'), { ownerUid: OWNER, published: true }); // visibility無し
  });
});
afterAll(async () => { await env.cleanup(); });

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('profile_pages read', () => {
  it('public は匿名でも読める', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/pub'))); });
  it('unlisted は匿名でも読める(URL知る人)', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/unl'))); });
  it('private は他者は読めない', async () => { await assertFails(getDoc(doc(as(OTHER), 'profile_pages/priv'))); });
  it('private は本人は読める', async () => { await assertSucceeds(getDoc(doc(as(OWNER), 'profile_pages/priv'))); });
  it('private は admin は読める', async () => { await assertSucceeds(getDoc(doc(as(ADMIN), 'profile_pages/priv'))); });
  it('legacy(visibility無し,published=true) は読める', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/legacy'))); });
});

describe('profile_pages update/delete', () => {
  it('他者は更新できない', async () => { await assertFails(setDoc(doc(as(OTHER), 'profile_pages/pub'), { bio: 'x' }, { merge: true })); });
  it('本人は更新できる', async () => { await assertSucceeds(setDoc(doc(as(OWNER), 'profile_pages/pub'), { bio: 'x' }, { merge: true })); });
  it('admin は更新できる(takedown)', async () => { await assertSucceeds(setDoc(doc(as(ADMIN), 'profile_pages/pub'), { visibility: 'private' }, { merge: true })); });
});
