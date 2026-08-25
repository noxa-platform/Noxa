// グループ（org）階層とその権限解決。記録エンジン共通仕様 段 4。
// 正本: `~/dev/noxa-platform/_spec/RECORD-ENGINE.md` §1.3「スコープ」/「org の規則」
//
// ## 形
//   org_orgs/{orgId}            { name, parentOrgId: string | null, ir_version }
//   org_orgs/{orgId}/policy/default { roles: {...}, overrides: { uid: {...} } }
//   shop_shops/{shopId}         { orgPath: ["jp", "kansai", "minami"] }  // 直属は末尾
//
// `orgPath` に祖先を全部並べる（非正規化）のは、**セキュリティルールが木をたどれない**ため。
// ルールに繰り返しは書けず、1 リクエストで参照できる doc 数にも上限がある。
// 親を 1 段ずつ上がる書き方は段が増えた瞬間に破綻するが、配列なら
// `'kansai' in orgPath` の 1 回で済む。集計も同じ理屈で楽になる。
//
// ⚠️ 親を付け替えたら配下の店の `orgPath` を書き直す（サーバ側の一括処理）。
// これは移動であって編集ではないので履歴を残すこと。

/** グループの段で切り替える権限。既定は**全部オフ**（事故は「見えすぎ」の方が重い） */
export interface OrgPermissions {
  /** 同じグループ配下の他店の売上を見られる */
  seeSiblingShopSales?: boolean;
  /** 同じグループ配下の他店の顧客を見られる */
  seeSiblingShopCustomers?: boolean;
}

export type ResolvedOrgPermissions = Required<OrgPermissions>;

/** 何も許可しない状態。解決の出発点であり、判定できないときの答えでもある */
export const ORG_PERMISSIONS_NONE: ResolvedOrgPermissions = {
  seeSiblingShopSales: false,
  seeSiblingShopCustomers: false,
};

/** org_orgs/{orgId}/policy/default の形 */
export interface OrgPolicy {
  /** 役職ごとの既定 */
  roles?: Record<string, OrgPermissions>;
  /** 個人単位の上書き（殺すためだけに使う。後述） */
  overrides?: Record<string, OrgPermissions>;
}

export interface Org {
  name: string;
  /** 親グループ。最上段は null */
  parentOrgId: string | null;
  ir_version?: number;
}

const KEYS: (keyof OrgPermissions)[] = ['seeSiblingShopSales', 'seeSiblingShopCustomers'];

/**
 * グループ階層の権限を解決する。
 *
 * 解決順は **段の上から下へ、最後に個人**（全国 → 関西 → 店 → 個人の上書き）。
 * **下の段は「より厳しくする」ことだけできる**——親がオフなら子でオンにできない。
 * こうしないと、上位が絞った権限を下位が勝手に開けてしまう。
 *
 * @param policies `orgPath` と同じ順（祖先 → 直属）で並べた各段の policy。
 *                 段に policy が無ければ undefined を入れる（＝その段では何も変えない）
 * @param role     その店でのメンバー役職（owner / manager / accounting / cast）
 * @param uid      個人上書きの照合に使う
 */
export function resolveOrgPermissions(
  policies: readonly (OrgPolicy | null | undefined)[],
  role: string | null | undefined,
  uid?: string | null,
): ResolvedOrgPermissions {
  // 出発点は全部オフ。最上段が明示的にオンにするまで誰も何も見られない
  const result: ResolvedOrgPermissions = { ...ORG_PERMISSIONS_NONE };
  let started = false;

  for (const policy of policies) {
    if (!policy) continue;
    const fromRole = role ? policy.roles?.[role] : undefined;
    // その段が role について何も言っていなければ、上の段の判断をそのまま持ち越す
    if (!fromRole) continue;

    for (const key of KEYS) {
      const want = fromRole[key];
      if (want === undefined) continue;
      if (!started) {
        // 最初に言及した段が基準を作る
        result[key] = want === true;
      } else {
        // 以降の段は厳しくする方向のみ。親がオフなら子はオンにできない
        result[key] = result[key] && want === true;
      }
    }
    started = true;
  }

  // 個人上書きは**下の段と同じ扱い**＝殺すことだけできる。
  // ここで開けられると「役職から外したのに個人設定で見えたまま」を作れてしまう
  if (uid) {
    for (const policy of policies) {
      const ov = policy?.overrides?.[uid];
      if (!ov) continue;
      for (const key of KEYS) {
        if (ov[key] === undefined) continue;
        result[key] = result[key] && ov[key] === true;
      }
    }
  }

  return result;
}

/**
 * `orgPath` の正規化。外から来た値をそのまま信じない。
 * 文字列以外・空文字・重複を落とす（重複があると「同じ段に 2 回属する」ように見える）。
 */
export function normalizeOrgPath(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** その店が指定グループの配下か（祖先でも直属でもよい） */
export function isUnderOrg(orgPath: unknown, orgId: string): boolean {
  if (!orgId) return false;
  return normalizeOrgPath(orgPath).includes(orgId);
}

/** 直属のグループ（`orgPath` の末尾）。無所属なら null */
export function directOrgId(orgPath: unknown): string | null {
  const p = normalizeOrgPath(orgPath);
  return p.length ? p[p.length - 1] : null;
}

/**
 * 親を付け替えたときの新しい `orgPath` を作る。
 *
 * **自分自身や祖先を親に指定できない**（閉路になり、集計が無限に回る）。
 * 作れないときは null を返し、呼び出し側に拒否させる。
 */
export function buildOrgPath(parentPath: readonly string[], orgId: string): string[] | null {
  const base = normalizeOrgPath(parentPath as unknown);
  if (!orgId || base.includes(orgId)) return null;
  return [...base, orgId];
}
