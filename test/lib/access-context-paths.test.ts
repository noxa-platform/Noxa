import { describe, expect, it } from 'vitest';
import type { AccessContext } from '../../src/app/api/lib/access-context';
import {
  pathCustomers, pathCustomer, pathCustomerLogs, pathCustomerSubcollection,
  pathSales, pathStandaloneSales, pathAiThreads, pathAiThread,
  pathSelfStyle, pathReminders, pathTemplates, pathGoals,
  pathAiFeedback, pathAiProfile, pathWorkspaceSettings,
} from '../../src/app/api/lib/access-context';

// テナント隔離のパスビルダー（情報漏洩防止の境界・Admin SDK は rules を迂回するため
// path の正しさが唯一の防壁）。shop/personal で必ず別テナントの path を返すことを固定する（Day60）。

const shop: AccessContext = { kind: 'shop', shopId: 'S1', uid: 'U1', role: 'owner' };
const personal: AccessContext = { kind: 'personal', uid: 'U1' };

describe('access-context path helpers — shop コンテキスト', () => {
  it('shop 系は必ず shop_shops/{shopId} 配下（uid を混ぜない）', () => {
    expect(pathCustomers(shop)).toBe('shop_shops/S1/customers');
    expect(pathSales(shop)).toBe('shop_shops/S1/sales');
    expect(pathStandaloneSales(shop)).toBe('shop_shops/S1/standalone_sales');
    expect(pathAiThreads(shop)).toBe('shop_shops/S1/ai_threads');
    expect(pathReminders(shop)).toBe('shop_shops/S1/reminders');
    expect(pathTemplates(shop)).toBe('shop_shops/S1/templates');
    expect(pathGoals(shop)).toBe('shop_shops/S1/goals');
    expect(pathAiProfile(shop)).toBe('shop_shops/S1/ai_profile/self');
    expect(pathWorkspaceSettings(shop)).toBe('shop_shops/S1');
  });
});

describe('access-context path helpers — personal コンテキスト', () => {
  it('personal 系は必ず 呼出者 uid 配下（shopId を混ぜない）', () => {
    expect(pathCustomers(personal)).toBe('personal_customers/U1/items');
    expect(pathSales(personal)).toBe('personal_sales/U1/items');
    expect(pathStandaloneSales(personal)).toBe('personal_sales/U1/standalone');
    expect(pathAiThreads(personal)).toBe('personal_ai_threads/U1/items');
    expect(pathReminders(personal)).toBe('personal_reminders/U1/items');
    expect(pathTemplates(personal)).toBe('personal_templates/U1/items');
    expect(pathGoals(personal)).toBe('personal_goals/U1/items');
    expect(pathAiProfile(personal)).toBe('personal_self_styles/U1');
    // 個人は shop_shops/{uid} が実体を持たないため account_users 配下（2026-08-25 決定）
    expect(pathWorkspaceSettings(personal)).toBe('account_users/U1/settings/workspace');
  });
});

describe('access-context path helpers — 非自明な分岐の固定', () => {
  it('pathSales と pathStandaloneSales は別 collection（items vs standalone_sales/standalone）', () => {
    // member-stats は pathSales(items) を、ai-chat は pathStandaloneSales を読む＝別データ源。
    // 同一データではないため groupCount 既定の差は不整合ではない（Day59 finding の訂正）。
    expect(pathSales(shop)).not.toBe(pathStandaloneSales(shop));
    expect(pathSales(personal)).not.toBe(pathStandaloneSales(personal));
  });
  it('pathSelfStyle は shop/personal どちらでも uid 単位（自分の文体は uid スコープ）', () => {
    expect(pathSelfStyle(shop)).toBe('personal_self_styles/U1');
    expect(pathSelfStyle(personal)).toBe('personal_self_styles/U1');
  });
  it('AI スレッド: shop は生パス shop_shops/{wid}/ai_threads と一致・personal は分岐（Day61 修正の安全性）', () => {
    // Day61: ai/threads・[threadId]・chat/history が生 shop パスで、ai/chat(pathAiThread)と
    // personal で食い違い会話同期不能だった。shop は helper===生パスで挙動不変、personal のみ是正。
    expect(pathAiThreads(shop)).toBe(`shop_shops/${shop.shopId}/ai_threads`);
    expect(pathAiThread(shop, 't1')).toBe(`shop_shops/${shop.shopId}/ai_threads/t1`);
    expect(pathAiThreads(personal)).not.toBe(`shop_shops/${personal.uid}/ai_threads`);
    expect(pathAiThread(personal, 't1')).toBe('personal_ai_threads/U1/items/t1');
  });
  it('顧客系: shop は生パス shop_shops/{wid}/customers... と一致・personal は分岐（Day63 バッチ修正の安全性）', () => {
    // Day63: ai/suggest・message(+analyze)・customer-infer-profile・learn-from-text・insights が
    // 生 shop 顧客パスで personal CRM の AI が全滅し得た。shop は helper===生パスで挙動不変。
    const wid = shop.shopId;
    expect(pathCustomers(shop)).toBe(`shop_shops/${wid}/customers`);
    expect(pathCustomer(shop, 'c1')).toBe(`shop_shops/${wid}/customers/c1`);
    expect(pathCustomerLogs(shop, 'c1')).toBe(`shop_shops/${wid}/customers/c1/logs`);
    expect(pathAiFeedback(shop, 'c1')).toBe(`shop_shops/${wid}/customers/c1/ai_feedback`);
    // personal は別テナントへ分岐（生 shop パスにならない）
    expect(pathCustomers(personal)).toBe('personal_customers/U1/items');
    expect(pathCustomerLogs(personal, 'c1')).toBe('personal_customers/U1/items/c1/logs');
  });
  it('AI プロフィール: shop は生パス shop_shops/{wid}/ai_profile/self と一致・personal は分岐（Day62 修正の安全性）', () => {
    // Day62: beta-profile-reward の GET が生 shop パス固定で、POST(ctx.kind 分岐)と食い違い
    // personal ユーザーの診断が常に空＝報酬 UI を出せなかった。shop は helper===生パスで挙動不変。
    expect(pathAiProfile(shop)).toBe(`shop_shops/${shop.shopId}/ai_profile/self`);
    expect(pathAiProfile(personal)).not.toBe(`shop_shops/${personal.uid}/ai_profile/self`);
    expect(pathAiProfile(personal)).toBe('personal_self_styles/U1');
  });
  it('サブパスは親パスを前置する', () => {
    expect(pathCustomer(shop, 'c9')).toBe('shop_shops/S1/customers/c9');
    expect(pathCustomerLogs(personal, 'c9')).toBe('personal_customers/U1/items/c9/logs');
    expect(pathCustomerSubcollection(shop, 'c9', 'gifts')).toBe('shop_shops/S1/customers/c9/gifts');
    expect(pathAiThread(personal, 't3')).toBe('personal_ai_threads/U1/items/t3');
    expect(pathAiFeedback(shop, 'c9')).toBe('shop_shops/S1/customers/c9/ai_feedback');
  });
});

describe('access-context path helpers — テナント越境しない不変条件', () => {
  it('personal path は shopId を、shop path は他 uid スコープの personal_ を含まない', () => {
    const personalPaths = [
      pathCustomers, pathSales, pathStandaloneSales, pathAiThreads,
      pathReminders, pathTemplates, pathGoals,
    ].map((f) => f(personal));
    for (const p of personalPaths) expect(p).not.toContain('shop_shops/');

    const shopPaths = [
      pathCustomers, pathSales, pathStandaloneSales, pathAiThreads,
      pathReminders, pathTemplates, pathGoals,
    ].map((f) => f(shop));
    // shop の顧客/売上系は personal_ コレクションに漏れない
    for (const p of shopPaths) expect(p.startsWith('shop_shops/S1/')).toBe(true);
  });

// 個人ワークスペースの設定が shop_shops 側へ漏れない（実体の無い doc を書きに行かない）
describe('pathWorkspaceSettings — 個人と店舗の分離', () => {
  const shop = { kind: 'shop', shopId: 'S1', uid: 'U1' } as never;
  const personal = { kind: 'personal', uid: 'U1' } as never;

  it('個人の設定先は shop_shops を指さない', () => {
    expect(pathWorkspaceSettings(personal).startsWith('shop_shops/')).toBe(false);
    expect(pathWorkspaceSettings(personal)).not.toBe('shop_shops/U1');
  });

  it('店舗と個人で同じ uid でも別の場所になる', () => {
    expect(pathWorkspaceSettings(shop)).not.toBe(pathWorkspaceSettings(personal));
  });

  it('個人の設定は PII を持つ親 doc 自体ではなくサブドキュメント', () => {
    expect(pathWorkspaceSettings(personal)).not.toBe('account_users/U1');
    expect(pathWorkspaceSettings(personal).split('/').length).toBe(4);
  });
});
});
