// nomishugy v2 移行の申し送り B-1 / B-2 への回答を rules で固定する（2026-08-25）。
//
// B-1: nomishugy の日次手入力売上は shop_shops/{shopId}/daily_close/{date} に置く。
//      POS 伝票（sales）と混ぜない。sales には syncShopSaleToPersonal が全書込みで
//      反応して personal_* へ投影するため、日次集計を混ぜると投影経路に伝票でないものが乗る。
// B-2: 所属は members/{uid} に統合せず affiliations/{castUid} を新設。
//      members の doc の存在が isShopMember() の判定＝認可の一次情報なので、
//      pending の行を members に置くと承認前から店のデータが読めてしまう。
//      在店は店舗配下 availability/{castUid}。
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'nm_owner';
const MANAGER = 'nm_manager';
const CAST = 'nm_cast';
const OTHER_CAST = 'nm_cast2';
const OUTSIDER = 'nm_outsider';
const SHOP = 'shop_nomishugy';

const AFFIL = `shop_shops/${SHOP}/affiliations/${CAST}`;
const AVAIL = `shop_shops/${SHOP}/availability/${CAST}`;
const CLOSE = `shop_shops/${SHOP}/daily_close/2026-08-25`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

// 各テストが status を書き換えるので毎回シードし直す。
// ⚠️ env.clearFirestore() は使わない——**エミュレータ全体**を消すため、同じ実行に
// 相乗りしている他の rules テストファイルの beforeAll シードまで巻き添えで消える
// （実際にやって 7 ファイルが道連れで落ちた）。
// create 系のテストは「doc が存在しないこと」に依存するので、テストごとに別 uid を使って
// 順序への依存そのものを無くす（前のテストが作った doc で create が update に化けると、
// 別の許可ブランチを踏んで緑になってしまう）。
beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: 'のみしゅぎの店', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${MANAGER}`), { role: 'manager' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OTHER_CAST}`), { role: 'cast' });
    // CAST は「申請されたがまだメンバーではない」状態にしておく（承認前）
    await setDoc(doc(db, AFFIL), { castUid: CAST, status: 'pending_cast', createdBy: OWNER });
    await setDoc(doc(db, AVAIL), { castUid: CAST, isAvailable: false });
    // OTHER_CAST は「メンバーである本人」の経路を見るために実在させる
    await setDoc(doc(db, `shop_shops/${SHOP}/availability/${OTHER_CAST}`), { castUid: OTHER_CAST, isAvailable: false });
    await setDoc(doc(db, CLOSE), { date: '2026-08-25', totalSales: 120000, groupCount: 8 });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('B-1: 日次手入力売上は daily_close/{date}（POS 伝票と混ざらない）', () => {
  it('オーナーは日次合計を書ける', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), CLOSE), {
      date: '2026-08-25', totalSales: 150000, groupCount: 9, source: 'nomishugy_manual',
    }));
  });
  it('メンバーは読める', async () => {
    await assertSucceeds(getDoc(doc(as(OTHER_CAST), CLOSE)));
  });
  it('キャストは書けない（確定数字は店側のもの）', async () => {
    await assertFails(updateDoc(doc(as(OTHER_CAST), CLOSE), { totalSales: 1 }));
  });
  it('部外者は読めない', async () => {
    await assertFails(getDoc(doc(as(OUTSIDER), CLOSE)));
  });
});

describe('B-2: affiliations — 申請は店から、承認は本人から', () => {
  it('オーナーは pending_cast で申請を作れる', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/affiliations/nm_apply_ok`), {
      castUid: 'nm_apply_ok', status: 'pending_cast', createdBy: OWNER,
    }));
  });

  // active で作れてしまうと「申請→承認」が素通りする
  it('オーナーでも active で作ることはできない', async () => {
    await assertFails(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/affiliations/nm_apply_active`), {
      castUid: 'nm_apply_active', status: 'active', createdBy: OWNER,
    }));
  });

  it('castUid がパスと食い違う申請は作れない（なりすまし防止）', async () => {
    await assertFails(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/affiliations/nm_apply_mismatch`), {
      castUid: CAST, status: 'pending_cast',
    }));
  });

  it('キャスト本人は自分宛の申請を読める（まだメンバーではないので isShopMember では読めない）', async () => {
    await assertSucceeds(getDoc(doc(as(CAST), AFFIL)));
  });

  it('キャスト本人は承認できる', async () => {
    await assertSucceeds(updateDoc(doc(as(CAST), AFFIL), { status: 'active', respondedAt: 1 }));
  });

  it('キャスト本人は拒否できる', async () => {
    await assertSucceeds(updateDoc(doc(as(CAST), AFFIL), { status: 'rejected', respondedAt: 1 }));
  });

  // 承認のついでに権限や可視性を自分で書き換えられては困る
  it('キャストは status 以外を書き換えられない', async () => {
    await assertFails(updateDoc(doc(as(CAST), AFFIL), { status: 'active', permissions: ['admin'] }));
    await assertFails(updateDoc(doc(as(CAST), AFFIL), { status: 'active', isVisible: true }));
  });

  it('キャストは自分を revoked にはできない（取り消しは店側の操作）', async () => {
    await assertFails(updateDoc(doc(as(CAST), AFFIL), { status: 'revoked' }));
  });

  it('他人の申請には触れない', async () => {
    await assertFails(getDoc(doc(as(OUTSIDER), AFFIL)));
    await assertFails(updateDoc(doc(as(OUTSIDER), AFFIL), { status: 'active' }));
  });

  it('オーナーは revoke でき、削除もできる', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), AFFIL), { status: 'revoked' }));
    await assertSucceeds(deleteDoc(doc(as(OWNER), AFFIL)));
  });

  // ここが B-2 の肝。affiliations を active にしただけでは入店にならない
  it('キャストは承認しても members/{uid} を自分で作れない（実体化はサーバ側）', async () => {
    await assertSucceeds(updateDoc(doc(as(CAST), AFFIL), { status: 'active', respondedAt: 1 }));
    await assertFails(setDoc(doc(as(CAST), `shop_shops/${SHOP}/members/${CAST}`), { role: 'cast' }));
  });

  it('申請が active でも、members が無いうちは店のデータを読めない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), AFFIL), { castUid: CAST, status: 'active' });
    });
    await assertFails(getDoc(doc(as(CAST), CLOSE)));
  });
});

describe('B-2: availability — 店舗配下・本人と店側のみ', () => {
  it('本人（メンバー）は自分の在店を更新できる', async () => {
    await assertSucceeds(updateDoc(doc(as(OTHER_CAST), `shop_shops/${SHOP}/availability/${OTHER_CAST}`), { isAvailable: true }));
  });
  it('メンバーでない本人は書けない', async () => {
    await assertFails(updateDoc(doc(as(CAST), AVAIL), { isAvailable: true }));
  });
  it('他人の在店は書き換えられない', async () => {
    await assertFails(updateDoc(doc(as(OTHER_CAST), AVAIL), { isAvailable: true }));
  });
  it('オーナーは代理で更新できる', async () => {
    await assertSucceeds(updateDoc(doc(as(OWNER), AVAIL), { isAvailable: true }));
  });
  it('メンバーは読める / 部外者は読めない', async () => {
    await assertSucceeds(getDoc(doc(as(MANAGER), AVAIL)));
    await assertFails(getDoc(doc(as(OUTSIDER), AVAIL)));
  });
});
