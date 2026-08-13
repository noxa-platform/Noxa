import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SALES_EDIT_ROLES,
  SALES_EDIT_ROLE_LABEL,
  describeSalesEditDenied,
  describeDelegateRequest,
  describeOwnerSettingDenied,
} from '../../src/lib/permission-guidance';
import { hasRole } from '../../src/lib/shop-role-state';

// 条件つきの到達性の続き（Day114）: ゲートで閉じた**後**に、その利用者の次の一手があるか。
// 見つかった穴はどれも「文言そのものが行き止まりを作る」形だった:
//   1. できない操作を指示する（未収の削除に失敗 →「売掛管理から削除してください」だが、
//      その画面は売上編集権限が要る＝案内先を開けない）
//   2. 実態より狭く言い切る（売掛・リスク客は owner/manager/accounting が使えるのに
//      「このモジュールはオーナー専用です」＝店長・経理が諦める）
//   3. 在籍しているのに「店舗を登録してください」（POS 設定・Day109 の誤誘導と同型）

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('案内文（純ロジック）', () => {
  it('権限で閉じたら「誰に頼めばよいか」を必ず含む', () => {
    for (const text of [
      describeSalesEditDenied('売掛管理'),
      describeDelegateRequest('売掛管理からの未収の削除'),
      describeOwnerSettingDenied('料金・メニュー'),
    ]) {
      expect(text).toMatch(/依頼/);
    }
  });

  it('売上編集権限の案内は実態どおり（「オーナー専用」と言い切らない）', () => {
    const text = describeSalesEditDenied('売掛管理');
    expect(text).toContain(SALES_EDIT_ROLE_LABEL);
    expect(text).not.toMatch(/オーナー専用/);
  });

  it('自分で開けない画面での自己解決を指示しない', () => {
    // 「〜から削除してください」型（案内先に権限が要る＝開けない）を作らないこと
    const text = describeDelegateRequest('売掛管理からの未収の削除');
    expect(text).not.toMatch(/から(削除|変更|設定|操作)してください/);
    expect(text).toMatch(/依頼してください/);
  });

  it('ロール定数は判定にそのまま渡せる（オーナーは常に許可・取得失敗は許可へ倒さない）', () => {
    expect(hasRole({ canManage: true, role: null }, SALES_EDIT_ROLES)).toBe(true);
    expect(hasRole({ canManage: false, role: 'manager' }, SALES_EDIT_ROLES)).toBe(true);
    expect(hasRole({ canManage: false, role: 'accounting' }, SALES_EDIT_ROLES)).toBe(true);
    expect(hasRole({ canManage: false, role: 'cast' }, SALES_EDIT_ROLES)).toBe(false);
    expect(hasRole({ canManage: false, role: null }, SALES_EDIT_ROLES)).toBe(false);
  });
});

describe('UI の許可基準が rules と一致していること', () => {
  const RULES = read('firestore.rules');

  it('unpaid / risk_customers は rules 側も売上編集権限で守られている', () => {
    // ここが owner 限定に変わったら UI 文言（オーナー・店長・経理）も直す必要がある
    expect(RULES).toMatch(/match \/unpaid\/\{id\}\s*\{\s*allow read, write: if isShopMemberWithSalesEdit\(shopId\);/);
    expect(RULES).toMatch(/match \/risk_customers\/\{id\}\s*\{\s*allow read, write: if isShopMemberWithSalesEdit\(shopId\);/);
  });

  it('isShopMemberWithSalesEdit のロール集合が SALES_EDIT_ROLES と一致する', () => {
    const fn = RULES.slice(RULES.indexOf('function isShopMemberWithSalesEdit'));
    const body = fn.slice(0, fn.indexOf('}') + 1);
    for (const role of SALES_EDIT_ROLES) expect(body).toContain(role);
  });
});

describe('権限で閉じた画面が「できない操作」を指示していないこと（静的ガード）', () => {
  it('売掛・リスク客は共通の案内ヘルパーを使い、オーナー専用と表示しない', () => {
    for (const f of [
      'src/components/modules/unpaid/UnpaidClient.tsx',
      'src/components/modules/risk/RiskClient.tsx',
    ]) {
      const src = read(f);
      expect(src).toMatch(/describeSalesEditDenied/);
      expect(src).toMatch(/hasShopRole\(shop, SALES_EDIT_ROLES\)/);
      // 表示文言としての「オーナー専用」を残さない（コメントでの言及は上の注記のみ許容）
      const shown = src.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
      expect(shown.join('\n')).not.toMatch(/オーナー専用/);
    }
  });

  it('売上取消の未収削除失敗が、権限の要る画面での自己解決を指示しない', () => {
    const src = read('src/components/modules/sales/SalesClient.tsx');
    expect(src).not.toMatch(/売掛管理から削除してください/);
    expect(src).toMatch(/describeDelegateRequest/);
  });

  it('POS 設定が在籍スタッフに「店舗を登録」と誘導しない（所属を確認してから出す）', () => {
    const src = read('src/components/modules/pos-config/PosConfigClient.tsx');
    // 所属（memberships）を見ずに店舗登録 CTA を出すのが Day109 型の誤誘導
    expect(src).toMatch(/memberships/);
    expect(src).toMatch(/describeOwnerSettingDenied/);
  });
});
