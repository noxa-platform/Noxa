// 記録の版（`ir_version`）を載せた**クライアント書込**が rules を通ることの固定（P145）。
//
// なぜ要るか: 段 3 の適用で、クライアントが作る記録の doc に `ir_version` が 1 つ増えた。
// Firestore の rules には **項目の allowlist（`keys().hasOnly([...])`）** を使う場所があり、
// そこへ項目を足すと**その瞬間から書込が全部 permission-denied になる**。
// しかも症状はビルドにもテストにも出ず、本番で「保存できない」としてだけ現れる。
//
// ＝ 版を刻む先ごとに「rules が余分な項目を許すか」を実際に書いて確かめる必要がある。
// 併せて、allowlist で閉じているコレクション（`bar_analytics`）は**刻んではいけない側**
// であることを、拒否される事実として固定する（境界を残さないと将来また踏む）。
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

const OWNER = 'irv_owner';
const MEMBER = 'irv_member';
const SHOP = 'irv_shop';
const V = { ir_version: 1 } as const;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `shop_shops/${SHOP}`), { name: 'IRV', ownerUid: OWNER });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${OWNER}`), { role: 'owner', status: 'active' });
    await setDoc(doc(db, `shop_shops/${SHOP}/members/${MEMBER}`), { role: 'cast', status: 'active' });
    // コミュニティは招待済み会員のみ書ける（noxa_users の存在が会員の印）
    await setDoc(doc(db, `noxa_users/${MEMBER}`), { uid: MEMBER });
  });
});
afterAll(async () => { await env.cleanup(); });

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('店舗の記録は ir_version 付きで作成できる', () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ['個別売上', `shop_shops/${SHOP}/sales/irv_sale`, { amount: 1000, castUid: MEMBER, ...V }],
    ['顧客台帳', `shop_shops/${SHOP}/customers/irv_cust`, { name: 'テスト', ...V }],
    ['売掛', `shop_shops/${SHOP}/unpaid/irv_unpaid`, { customerName: 'テスト', unpaidAmount: 500, ...V }],
    ['席回しの名簿', `shop_shops/${SHOP}/seating_casts/irv_cast`, { name: 'テスト', ...V }],
    ['卓', `shop_shops/${SHOP}/seating_tables/irv_tbl`, { name: 'A1', ...V }],
    ['待ち行列', `shop_shops/${SHOP}/seating_queue/irv_q`, { name: 'テスト', ...V }],
    ['メニューのインフォカード', `shop_shops/${SHOP}/menu_info_cards/irv_info`, { label: 'お知らせ', ...V }],
    ['メニューのオーダー', `shop_shops/${SHOP}/menu_orders/irv_order`, { seat: 'A1', ...V }],
  ];
  it.each(cases)('%s', async (_label, path, data) => {
    await assertSucceeds(setDoc(doc(as(OWNER), path), data));
  });

  // 出勤は「本人の castUid」でしか書けない（役割条件が版の追加で壊れていないこと）
  it('出勤（本人の shifts）', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), `shop_shops/${SHOP}/shifts/irv_shift`), {
      castUid: MEMBER, date: '2026-08-25', ...V,
    }));
  });
});

describe('個人ワークスペースの記録も ir_version 付きで作成できる', () => {
  it('個人の売上（personal_sales）', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), `personal_sales/${MEMBER}/items/irv_ps`), {
      amount: 3000, ...V,
    }));
  });
  it('個人のリマインダー', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), `personal_reminders/${MEMBER}/items/irv_rm`), {
      title: '連絡', date: '2026-08-26', ...V,
    }));
  });
});

describe('アカウント・店舗・公開プロフィールも ir_version 付きで作成できる', () => {
  it('アカウント（新規登録）', async () => {
    await assertSucceeds(setDoc(doc(as('irv_new'), 'account_users/irv_new'), {
      id: 'irv_new', platformRole: 'user', ...V,
    }));
  });
  it('店舗（新規作成）', async () => {
    await assertSucceeds(setDoc(doc(as('irv_new2'), 'shop_shops/irv_shop2'), {
      name: '新店', ownerUid: 'irv_new2', ...V,
    }));
  });
  it('店舗作成直後のオーナー自己登録（members）', async () => {
    await assertSucceeds(setDoc(doc(as(OWNER), `shop_shops/${SHOP}/members/${OWNER}`), {
      role: 'owner', status: 'active', ...V,
    }));
  });
  it('公開プロフィール（handle の claim）', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'profile_pages/irv-handle'), {
      handle: 'irv-handle', ownerUid: MEMBER, type: 'user', ...V,
    }));
  });
});

describe('コミュニティの記録も ir_version 付きで作成できる', () => {
  it('スレッド', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'noxa_posts/irv_post'), {
      boardId: 'b1', title: 't', body: 'x', authorUid: MEMBER,
      likeCount: 0, commentCount: 0, official: false, ...V,
    }));
  });
  it('レス', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'noxa_comments/irv_cmt'), {
      postId: 'irv_post', body: 'x', authorUid: MEMBER, likeCount: 0, ...V,
    }));
  });
  it('いいね', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'noxa_likes/irv_like'), {
      uid: MEMBER, kind: 'thread', targetId: 'irv_post', ...V,
    }));
  });
  it('通報', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'noxa_reports/irv_rep'), {
      targetType: 'thread', targetId: 'irv_post', reporterUid: MEMBER, status: 'open', ...V,
    }));
  });
});

// 刻んではいけない側の境界。ここに版を足すと**書込が全部 denied になる**ので、
// 拒否される事実そのものをテストにして残す（網羅ガードの EXEMPT と対になる）。
describe('項目 allowlist で閉じたコレクションは版を受け付けない（刻まない側の境界）', () => {
  it('bar_analytics は ir_version 付きの create が拒否される', async () => {
    await assertFails(setDoc(doc(as(MEMBER), 'bar_analytics/irv_bar_2026-08-25'), {
      barId: 'irv_bar', date: '2026-08-25', pageViews: 1, ...V,
    }));
  });
  it('bar_analytics は ir_version 無しなら通る（拒否の理由が版であることの確認）', async () => {
    await assertSucceeds(setDoc(doc(as(MEMBER), 'bar_analytics/irv_bar_2026-08-26'), {
      barId: 'irv_bar', date: '2026-08-26', pageViews: 1,
    }));
  });
});
