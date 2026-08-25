// 記録エンジンの永続化まわりの共通部品（P152）。
//
// `apply` / `revert` はどちらも「読んで → 計算して → 書く」なので、**必ずトランザクション**で行う。
// 別々に成否が分かれると、次の壊れ方が生まれる:
//   - スキーマだけ書けて控えが書けない → **足したのに取り消せない**
//   - 控えだけ書けてスキーマが書けない → **足していないのに控えがある**（取り消すと他人の項目が消える）
import { getAdminDb } from '../lib/firebase-admin';
import type { AccessContext } from '../lib/access-context';

/** スキーマの置き場所（段 5 で決めた単一 doc） */
export function pathRecordSchema(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/settings/record_schema`
    : `account_users/${ctx.uid}/settings/record_schema`;
}

/**
 * 適用の控えの置き場所。**1 世代なので単一 doc・適用のたびに上書き**。
 *
 * スキーマと**別 doc**にする理由: 控えは運営情報（何を AI が足したか）で、
 * スキーマは記録画面がメンバー全員に見せる必要がある。同じ doc に入れると
 * 「メンバーに見せる」と「owner だけに見せる」を分けられない。
 */
export function pathRecordSchemaReceipt(ctx: AccessContext): string {
  return ctx.kind === 'shop'
    ? `shop_shops/${ctx.shopId}/settings/record_schema_receipt`
    : `account_users/${ctx.uid}/settings/record_schema_receipt`;
}

/**
 * 記録の仕組みを変えられるか。店では **owner 専用**（P148 / P151 と同じ境界）。
 * キャストが項目や計算式を変えられると、店全体の集計の意味が勝手に変わる。
 */
export function canEditRecordEngine(ctx: AccessContext): boolean {
  return ctx.kind !== 'shop' || ctx.role === 'owner';
}

/** 控えの token。**推測されても実害は無い**（所有者しか読めない doc の中身と突き合わせるだけ） */
export function makeReceiptToken(now: number): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `rp_${now.toString(36)}_${rand}`;
}

export { getAdminDb };
