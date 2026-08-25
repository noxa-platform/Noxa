import { describe, it, expect } from 'vitest';
import {
  resolveOrgPermissions, normalizeOrgPath, isUnderOrg, directOrgId, buildOrgPath,
  ORG_PERMISSIONS_NONE, type OrgPolicy,
} from '@/lib/org';

// グループ（org）階層と権限解決。記録エンジン段 4。
// 仕様の核: 既定は全部オフ / 解決は段の上から下へ / **下の段は厳しくすることだけできる**。

describe('resolveOrgPermissions — 既定は全部オフ', () => {
  it('policy が無ければ何も許可しない', () => {
    expect(resolveOrgPermissions([], 'owner')).toEqual(ORG_PERMISSIONS_NONE);
    expect(resolveOrgPermissions([null, undefined], 'owner')).toEqual(ORG_PERMISSIONS_NONE);
  });

  it('role について何も書いていない policy は何も変えない', () => {
    const p: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true } } };
    expect(resolveOrgPermissions([p], 'cast')).toEqual(ORG_PERMISSIONS_NONE);
  });

  it('role が未指定でも落ちない', () => {
    const p: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true } } };
    expect(resolveOrgPermissions([p], null)).toEqual(ORG_PERMISSIONS_NONE);
  });

  it('明示的に true と書かれた項目だけオンになる', () => {
    const p: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true } } };
    expect(resolveOrgPermissions([p], 'manager')).toEqual({
      seeSiblingShopSales: true, seeSiblingShopCustomers: false,
    });
  });
});

// ここが仕様の肝。上位が絞った権限を下位が勝手に開けられてはいけない
describe('下の段は厳しくすることだけできる', () => {
  const parentOn: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true, seeSiblingShopCustomers: true } } };
  const childOff: OrgPolicy = { roles: { manager: { seeSiblingShopSales: false } } };
  const parentOff: OrgPolicy = { roles: { manager: { seeSiblingShopSales: false } } };
  const childOn: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true } } };

  it('親がオン → 子がオフ にできる', () => {
    expect(resolveOrgPermissions([parentOn, childOff], 'manager').seeSiblingShopSales).toBe(false);
  });

  it('親がオフ → 子はオンにできない（権限の巻き返しを許さない）', () => {
    expect(resolveOrgPermissions([parentOff, childOn], 'manager').seeSiblingShopSales).toBe(false);
  });

  it('子が言及しない項目は親の判断がそのまま残る', () => {
    expect(resolveOrgPermissions([parentOn, childOff], 'manager').seeSiblingShopCustomers).toBe(true);
  });

  it('段を 3 つ重ねても、どこか 1 段でオフなら最終的にオフ', () => {
    const mid: OrgPolicy = { roles: { manager: { seeSiblingShopSales: false } } };
    expect(resolveOrgPermissions([parentOn, mid, childOn], 'manager').seeSiblingShopSales).toBe(false);
  });
});

describe('個人上書きは「殺す」ためだけに使える', () => {
  const on: OrgPolicy = { roles: { manager: { seeSiblingShopSales: true } } };

  it('個人単位でオフにできる', () => {
    const p: OrgPolicy = { ...on, overrides: { u1: { seeSiblingShopSales: false } } };
    expect(resolveOrgPermissions([p], 'manager', 'u1').seeSiblingShopSales).toBe(false);
  });

  it('他人の上書きは影響しない', () => {
    const p: OrgPolicy = { ...on, overrides: { u1: { seeSiblingShopSales: false } } };
    expect(resolveOrgPermissions([p], 'manager', 'u2').seeSiblingShopSales).toBe(true);
  });

  // 役職から外したのに個人設定で見えたまま、を作らせない
  it('役職がオフなら個人上書きでオンにはできない', () => {
    const off: OrgPolicy = {
      roles: { manager: { seeSiblingShopSales: false } },
      overrides: { u1: { seeSiblingShopSales: true } },
    };
    expect(resolveOrgPermissions([off], 'manager', 'u1').seeSiblingShopSales).toBe(false);
  });

  it('uid を渡さなければ上書きは効かない', () => {
    const p: OrgPolicy = { ...on, overrides: { u1: { seeSiblingShopSales: false } } };
    expect(resolveOrgPermissions([p], 'manager').seeSiblingShopSales).toBe(true);
  });
});

describe('orgPath の正規化（外から来た値を信じない）', () => {
  it('配列でなければ空', () => {
    for (const v of [null, undefined, 'jp', 3, {}]) expect(normalizeOrgPath(v)).toEqual([]);
  });

  it('文字列以外・空文字を落とす', () => {
    expect(normalizeOrgPath(['jp', 1, '', null, ' ', 'kansai'])).toEqual(['jp', 'kansai']);
  });

  // 重複があると「同じ段に 2 回属する」ように見え、集計が二重に乗る
  it('重複を落とす（順序は保つ）', () => {
    expect(normalizeOrgPath(['jp', 'kansai', 'jp'])).toEqual(['jp', 'kansai']);
  });

  it('前後の空白は詰める', () => {
    expect(normalizeOrgPath([' jp ', 'kansai'])).toEqual(['jp', 'kansai']);
  });
});

describe('配下判定と直属', () => {
  const path = ['jp', 'kansai', 'minami'];

  it('祖先でも直属でも配下と判定する', () => {
    expect(isUnderOrg(path, 'jp')).toBe(true);
    expect(isUnderOrg(path, 'minami')).toBe(true);
  });

  it('兄弟は配下ではない', () => {
    expect(isUnderOrg(path, 'kyushu')).toBe(false);
  });

  it('空の orgId・無所属は false', () => {
    expect(isUnderOrg(path, '')).toBe(false);
    expect(isUnderOrg([], 'jp')).toBe(false);
    expect(isUnderOrg(undefined, 'jp')).toBe(false);
  });

  it('直属は末尾', () => {
    expect(directOrgId(path)).toBe('minami');
    expect(directOrgId([])).toBeNull();
    expect(directOrgId(undefined)).toBeNull();
  });
});

describe('buildOrgPath — 閉路を作らせない', () => {
  it('親の path に自分を足す', () => {
    expect(buildOrgPath(['jp', 'kansai'], 'minami')).toEqual(['jp', 'kansai', 'minami']);
  });

  it('最上段は自分だけ', () => {
    expect(buildOrgPath([], 'jp')).toEqual(['jp']);
  });

  // 閉路になると集計が無限に回る
  it('自分が祖先に居る親は指定できない', () => {
    expect(buildOrgPath(['jp', 'kansai'], 'kansai')).toBeNull();
    expect(buildOrgPath(['jp'], 'jp')).toBeNull();
  });

  it('orgId が空なら作れない', () => {
    expect(buildOrgPath(['jp'], '')).toBeNull();
  });
});
