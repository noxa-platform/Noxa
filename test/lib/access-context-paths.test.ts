import { describe, expect, it } from 'vitest';
import type { AccessContext } from '../../src/app/api/lib/access-context';
import {
  pathCustomers, pathCustomer, pathCustomerLogs, pathCustomerSubcollection,
  pathSales, pathStandaloneSales, pathAiThreads, pathAiThread,
  pathSelfStyle, pathReminders, pathTemplates, pathGoals,
  pathAiFeedback, pathAiProfile,
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
});
