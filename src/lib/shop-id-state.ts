/**
 * 操作対象 shopId の解決（純ロジック・Day109）。
 *
 * `useShopId` / POS / 席回しの3か所に同じリゾルバが複製されており、いずれも
 *   try { 所有クエリ; 所属クエリ } catch { shopId = null }
 * と書かれていた。この形には2つの実害がある:
 *
 *  1. **読み取り失敗と「店舗に所属していない」が同一視される**。通信断やオフライン復帰直後に
 *     shopId=null になり、11画面が「所属店舗が見つかりません」と言い切る（＝店に所属しているのに
 *     未所属と表示され、画面が丸ごと閉じる）。Day108 の権限ゲート（roleError）と同型で、
 *     こちらは**権限より手前**なので影響範囲がさらに広い。
 *  2. **片方の失敗が結論を黙って変える**。所属クエリだけ失敗すると memberships が「空」として扱われ、
 *     アクティブ選択中のメンバー店舗ではなく所有店舗の先頭が選ばれる ＝ ユーザーが気づかないまま
 *     **別の店舗を操作する**。逆に所有クエリが失敗すると canManage=false となり、オーナーなのに
 *     管理操作のボタンだけが消える。
 *
 * そこで「取得できなかった（null）」を型で表し、**失敗した側が結論を変え得るときは確定しない**
 * （unresolved=true → 画面は「確認できませんでした」と案内して再読み込みを促す）。
 * 失敗時に権限を広げる判定は一切しない（canManage は所有クエリが読めたときのみ true になり得る）。
 */
import { pickShopId } from '@/lib/workspace';

/** 読み取り結果。`null` は「取得できなかった」＝「1件も無い」ではない */
export type ShopIdSources = {
  /** shop_shops.ownerUid == uid の結果（所有店舗ID） */
  owned: readonly string[] | null;
  /** account_users/{uid}/memberships の結果（所属店舗ID） */
  memberships: readonly string[] | null;
  /** localStorage のアクティブ選択（'personal' / shopId / 未設定 null） */
  active: string | null;
};

export type ShopIdState = {
  shopId: string | null;
  isOwner: boolean;
  /** 店舗を確定できなかった（＝「未所属」ではない）。true のとき shopId は必ず null */
  unresolved: boolean;
};

const UNRESOLVED: ShopIdState = { shopId: null, isOwner: false, unresolved: true };

export function resolveShopIdState(src: ShopIdSources): ShopIdState {
  const { owned, memberships, active } = src;

  // 個人ワークスペースの明示選択は「店舗が無い」ではなくユーザーの意思。読み取り失敗と混ぜない
  if (active === 'personal') return { shopId: null, isOwner: false, unresolved: false };

  // 所有クエリが読めないと isOwner（＝canManage）を判定できない。
  // false に倒すと「オーナーなのに管理操作が消える」無音の劣化になるため確定しない
  if (owned === null) return UNRESOLVED;

  if (memberships === null) {
    // 所属クエリの結果が結論を変え得るなら確定しない。
    // 変え得ないのは「所有店舗だけで選択が決まる」場合＝アクティブ選択が所有に含まれる or 未設定で所有あり
    const decidedByOwnedAlone = active ? owned.includes(active) : owned.length > 0;
    if (!decidedByOwnedAlone) return UNRESOLVED;
  }

  const { shopId, isOwner } = pickShopId([...owned], [...(memberships ?? [])], active);
  return { shopId, isOwner, unresolved: false };
}

/** 店舗を確定できなかったときに使う既定文言（原因が取れなかった場合のフォールバック） */
export const SHOP_UNRESOLVED_TEXT = '店舗情報を確認できませんでした。';

/** shopId が無いときの既定文言（本当に所属していない場合） */
export const SHOP_NOT_FOUND_TEXT = '所属店舗が見つかりません。';

/**
 * shopId が無いとき画面に出す文言。
 * 確認できなかっただけ（shopError あり）の場合に「所属していません」と言い切らないための単一入口。
 * @param shopError useShopId が返す確認失敗の説明（成功・未所属確定なら null）
 * @param notFound  本当に所属していないときの文言（画面ごとの補足を足したい場合に渡す）
 */
export function describeMissingShop(shopError: string | null, notFound: string = SHOP_NOT_FOUND_TEXT): string {
  if (!shopError) return notFound;
  return `${shopError} 所属していないのか、一時的に確認できないだけなのか判断できません。画面を再読み込みしてください。`;
}
