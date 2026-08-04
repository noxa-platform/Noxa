// Day100: noxa_blocks（コミュニティのブロック）の rules テスト。
// 背景: daily_close_rows と同型の「rules 未定義＝既定 deny」。iOS の
// FirestoreCommunityRepository+Moderation.swift（blockUser/unblockUser/listMyBlocks）が
// 全失敗しており、閲覧経路は fail-open で握り潰されるためブロック機能だけが無言で死んでいた。
// 方針は sibling の noxa_likes と同型（本人の存在ドキュメントのみ・更新不可）。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where } from 'firebase/firestore';

let env: RulesTestEnvironment;
const ME = 'blk_me';
const OTHER = 'blk_other';
const TARGET_ANON = 'anon_xyz';

// doc ID は iOS 実装と同じ `{自分のuid}_{相手anonId}`
const MY_BLOCK = `${ME}_${TARGET_ANON}`;
const OTHERS_BLOCK = `${OTHER}_${TARGET_ANON}`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `noxa_blocks/${MY_BLOCK}`), { blockerUid: ME, blockedAnonId: TARGET_ANON });
    await setDoc(doc(db, `noxa_blocks/${OTHERS_BLOCK}`), { blockerUid: OTHER, blockedAnonId: TARGET_ANON });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('noxa_blocks（本人のブロックのみ）', () => {
  it('本人は自分のブロックを読める（旧: rules 未定義で全 deny）', async () => {
    await assertSucceeds(getDoc(doc(as(ME), `noxa_blocks/${MY_BLOCK}`)));
  });
  it('本人の一覧は blockerUid で絞れば通る（iOS の実クエリ形）', async () => {
    await assertSucceeds(getDocs(query(
      collection(as(ME), 'noxa_blocks'), where('blockerUid', '==', ME),
    )));
  });
  it('他人のブロックリストは読めない（誰が誰をブロックしたかを漏らさない）', async () => {
    await assertFails(getDoc(doc(as(ME), `noxa_blocks/${OTHERS_BLOCK}`)));
    await assertFails(getDocs(query(
      collection(as(ME), 'noxa_blocks'), where('blockerUid', '==', OTHER),
    )));
  });
  it('無絞りの一覧は拒否', async () => {
    await assertFails(getDocs(collection(as(ME), 'noxa_blocks')));
  });
  it('本人名義でブロックを作成できる', async () => {
    await assertSucceeds(setDoc(doc(as(ME), `noxa_blocks/${ME}_anon_new`), {
      blockerUid: ME, blockedAnonId: 'anon_new',
    }));
  });
  it('他人名義のブロックは作成できない（なりすまし防止）', async () => {
    await assertFails(setDoc(doc(as(ME), `noxa_blocks/${OTHER}_anon_new2`), {
      blockerUid: OTHER, blockedAnonId: 'anon_new2',
    }));
  });
  it('更新は不可（create/delete のトグルのみ・noxa_likes と同型）', async () => {
    await assertFails(setDoc(
      doc(as(ME), `noxa_blocks/${MY_BLOCK}`), { blockedAnonId: 'anon_swapped' }, { merge: true },
    ));
  });
  it('本人は自分のブロックを解除（削除）できる', async () => {
    await assertSucceeds(deleteDoc(doc(as(ME), `noxa_blocks/${MY_BLOCK}`)));
  });
  it('他人のブロックは解除できない', async () => {
    await assertFails(deleteDoc(doc(as(ME), `noxa_blocks/${OTHERS_BLOCK}`)));
  });
  it('未認証は読み書きできない', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, `noxa_blocks/${OTHERS_BLOCK}`)));
    await assertFails(setDoc(doc(anon, 'noxa_blocks/x_y'), { blockerUid: 'x', blockedAnonId: 'y' }));
  });
});
