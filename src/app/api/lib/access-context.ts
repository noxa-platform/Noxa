/**
 * Access Context: shop / personal の厳密分離。
 *
 * 🔐 情報漏洩防止のため、すべての API route はこの helper で context を決定する。
 * Admin SDK は Firestore rules をバイパスするので、サーバー側で context 境界を守る。
 *
 * 判定ロジック:
 *   1. workspaceId が `shop_shops/{wid}` として存在し、かつ uid が owner/member → shop context
 *   2. workspaceId === uid（呼出者本人の uid） → personal context
 *   3. 上記いずれにも該当しなければ AuthError throw
 *
 * 「個人ユーザーが事業 (shop) データに触れる」「事業メンバーが他人の personal データに触れる」
 * を構造的に防ぐ。
 */
import { AuthError, getAdminDb } from './firebase-admin';

export type AccessContext =
  | { kind: 'shop'; shopId: string; uid: string; role: 'owner' | 'member' }
  | { kind: 'personal'; uid: string };

export async function resolveAccessContext(
  uid: string,
  workspaceId: string,
): Promise<AccessContext> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new AuthError('workspaceId が不正です');
  }

  const db = getAdminDb();

  // 1. shop context 判定（先にチェック）
  const shopRef = db.doc(`shop_shops/${workspaceId}`);
  const shopSnap = await shopRef.get();
  if (shopSnap.exists) {
    const data = shopSnap.data() as { ownerUid?: string } | undefined;
    if (data?.ownerUid === uid) {
      return { kind: 'shop', shopId: workspaceId, uid, role: 'owner' };
    }
    const memberSnap = await db.doc(`shop_shops/${workspaceId}/members/${uid}`).get();
    if (memberSnap.exists) {
      return { kind: 'shop', shopId: workspaceId, uid, role: 'member' };
    }
    // shop は存在するが member ではない → 漏洩防止のため拒否
    throw new AuthError('この shop へのアクセス権限がありません');
  }

  // 2. personal context 判定（workspaceId が呼出者自身の uid のみ許可）
  if (workspaceId === uid) {
    return { kind: 'personal', uid };
  }

  // 3. 不正
  throw new AuthError('workspace が見つからないか、アクセス権限がありません');
}

// ============================================================
// Path helpers — context に応じて適切な v2 path を返す
// ============================================================

export function pathCustomers(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/customers`
    : `personal_customers/${ctx.uid}/items`;
}

export function pathCustomer(ctx: AccessContext, customerId: string): string {
  return `${pathCustomers(ctx)}/${customerId}`;
}

export function pathCustomerLogs(ctx: AccessContext, customerId: string): string {
  return `${pathCustomer(ctx, customerId)}/logs`;
}

export function pathCustomerSubcollection(
  ctx: AccessContext,
  customerId: string,
  sub: string,
): string {
  return `${pathCustomer(ctx, customerId)}/${sub}`;
}

export function pathSales(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/sales`
    : `personal_sales/${ctx.uid}/items`;
}

export function pathStandaloneSales(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/standalone_sales`
    : `personal_sales/${ctx.uid}/standalone`;
}

export function pathAiThreads(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/ai_threads`
    : `personal_ai_threads/${ctx.uid}/items`;
}

export function pathAiThread(ctx: AccessContext, threadId: string): string {
  return `${pathAiThreads(ctx)}/${threadId}`;
}

export function pathSelfStyle(ctx: AccessContext): string {
  // personal_self_styles は uid 単位。shop でも自分の文体は uid 単位で保持。
  return `personal_self_styles/${ctx.uid}`;
}

export function pathReminders(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/reminders`
    : `personal_reminders/${ctx.uid}/items`;
}

export function pathTemplates(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/templates`
    : `personal_templates/${ctx.uid}/items`;
}

export function pathGoals(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/goals`
    : `personal_goals/${ctx.uid}/items`;
}

export function pathAiFeedback(ctx: AccessContext, customerId: string): string {
  return `${pathCustomer(ctx, customerId)}/ai_feedback`;
}

export function pathAiProfile(ctx: AccessContext): string {
  // personal の場合 personal_self_styles 経由。shop の場合 ai_profile/self
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/ai_profile/self`
    : `personal_self_styles/${ctx.uid}`;
}
