import { describe, expect, it } from 'vitest';
import {
  resolveMemberPermissions,
  getWorkspaceType,
  normalizePlaceTags,
  getColorPreset,
} from '../../src/lib/types';
import type { MemberRole } from '../../src/lib/types';

// メンバー権限モデル（アクセス境界の executable spec・Day59）。
// override 機能は Phase 2 で配線予定だが、role 既定マトリクスと override 意味論・
// 未知 role の安全フォールバックをここで固定し、将来の配線時の権限事故を防ぐ。

describe('resolveMemberPermissions — role 既定マトリクス', () => {
  it('owner は全 true', () => {
    expect(resolveMemberPermissions({ role: 'owner' })).toEqual({
      canSeeAllCustomers: true, canSeeAllSales: true, canSeeMembers: true, canSeeBilling: true, canEditWorkspace: true,
    });
  });
  it('sub_owner は billing のみ false（課金はオーナー専用）', () => {
    expect(resolveMemberPermissions({ role: 'sub_owner' })).toEqual({
      canSeeAllCustomers: true, canSeeAllSales: true, canSeeMembers: true, canSeeBilling: false, canEditWorkspace: true,
    });
  });
  it('editor は billing/editWorkspace が false、他は true', () => {
    expect(resolveMemberPermissions({ role: 'editor' })).toEqual({
      canSeeAllCustomers: true, canSeeAllSales: true, canSeeMembers: true, canSeeBilling: false, canEditWorkspace: false,
    });
  });
  it('viewer は全 false', () => {
    expect(resolveMemberPermissions({ role: 'viewer' })).toEqual({
      canSeeAllCustomers: false, canSeeAllSales: false, canSeeMembers: false, canSeeBilling: false, canEditWorkspace: false,
    });
  });
});

describe('resolveMemberPermissions — override 意味論と安全フォールバック', () => {
  it('override の明示値（true/false）は role 既定より優先される', () => {
    // viewer に個別付与
    const p = resolveMemberPermissions({ role: 'viewer', permissions: { canSeeAllCustomers: true } });
    expect(p.canSeeAllCustomers).toBe(true);
    expect(p.canSeeAllSales).toBe(false); // 未指定は viewer 既定のまま
    // owner から個別剥奪
    const q = resolveMemberPermissions({ role: 'owner', permissions: { canSeeBilling: false } });
    expect(q.canSeeBilling).toBe(false);
    expect(q.canEditWorkspace).toBe(true);
  });
  it('override 未指定キーは role 既定に従う', () => {
    expect(resolveMemberPermissions({ role: 'editor', permissions: {} })).toEqual(
      resolveMemberPermissions({ role: 'editor' }),
    );
  });
  it('未知 role（旧データの生 string 等）は viewer 既定にフォールバック（安全側）', () => {
    const p = resolveMemberPermissions({ role: 'legacy_unknown' as unknown as MemberRole });
    expect(p).toEqual(resolveMemberPermissions({ role: 'viewer' }));
  });
  it('未知 role でも override は尊重される', () => {
    const p = resolveMemberPermissions({
      role: 'legacy_unknown' as unknown as MemberRole,
      permissions: { canSeeMembers: true },
    });
    expect(p.canSeeMembers).toBe(true);
    expect(p.canSeeBilling).toBe(false);
  });
});

describe('getWorkspaceType', () => {
  it('type 未設定は personal 扱い（旧データ互換）', () => {
    expect(getWorkspaceType({})).toBe('personal');
    expect(getWorkspaceType({ type: undefined })).toBe('personal');
  });
  it('明示された type を尊重する', () => {
    expect(getWorkspaceType({ type: 'business' })).toBe('business');
    expect(getWorkspaceType({ type: 'personal' })).toBe('personal');
  });
});

describe('normalizePlaceTags', () => {
  it('tags があればそれを返す', () => {
    expect(normalizePlaceTags({ name: 'X', tags: ['イタリアン', '同伴'] })).toEqual(['イタリアン', '同伴']);
  });
  it('tags 空で旧 category があれば 1 タグに合流', () => {
    expect(normalizePlaceTags({ name: 'X', tags: [], category: '焼肉' })).toEqual(['焼肉']);
    expect(normalizePlaceTags({ name: 'X', category: '寿司' })).toEqual(['寿司']);
  });
  it('どちらも無ければ空配列', () => {
    expect(normalizePlaceTags({ name: 'X' })).toEqual([]);
  });
});

describe('getColorPreset', () => {
  it('既知の色は preset を返す', () => {
    expect(getColorPreset('red')?.label).toBe('赤');
  });
  it('未知/空は undefined', () => {
    expect(getColorPreset('teal')).toBeUndefined();
    expect(getColorPreset('')).toBeUndefined();
    expect(getColorPreset(null)).toBeUndefined();
    expect(getColorPreset(undefined)).toBeUndefined();
  });
});
