import { describe, it, expect } from 'vitest';
import { resolveShopRoleState, hasRole } from '../../src/lib/shop-role-state';

// 店舗ロールの状態解決（Day108）。
//
// 実バグ: `useShopRole` は members/{uid} の取得失敗を catch して **role=null（＝権限なし）と同一視**し、
// roleReady も true にしていた。結果、通信断やオフライン復帰直後に
// 「このモジュールはオーナー専用です」が出て、**店長/経理には権限を剥奪されたように見える**
// （売掛・リスク・給与確定の画面が丸ごと閉じ、原因も分からない）。
// ここでは「role が無い」と「role を確認できなかった」が別物であることを固定する。
//
// 併せて **失敗時に許可へ倒さない**（roleError があっても hasRole は false）ことも固定する。

const base = { loading: false, shopId: 's1', canManage: false, fetched: null };

describe('resolveShopRoleState', () => {
  it('オーナーは members 不在でも owner（取得しないので roleError は無い）', () => {
    expect(resolveShopRoleState({ ...base, canManage: true })).toEqual({
      role: 'owner', roleReady: true, roleError: null,
    });
  });

  it('loading 中は roleReady=false（ゲート判定を待たせる）', () => {
    expect(resolveShopRoleState({ ...base, loading: true }).roleReady).toBe(false);
  });

  it('店舗未選択なら role=null だが roleReady=true（待たせない）', () => {
    expect(resolveShopRoleState({ ...base, shopId: null })).toEqual({
      role: null, roleReady: true, roleError: null,
    });
  });

  it('members が読めて role がある: そのまま採用', () => {
    const r = resolveShopRoleState({ ...base, fetched: { shopId: 's1', role: 'manager' } });
    expect(r).toEqual({ role: 'manager', roleReady: true, roleError: null });
  });

  it('members doc が無い（本当に権限なし）: role=null・roleError なし', () => {
    const r = resolveShopRoleState({ ...base, fetched: { shopId: 's1', role: null } });
    expect(r).toEqual({ role: null, roleReady: true, roleError: null });
  });

  it('**取得失敗**: role=null でも roleError を立てる（「権限なし」と区別する）', () => {
    const r = resolveShopRoleState({
      ...base,
      fetched: { shopId: 's1', role: null, error: '権限の確認に失敗しました。' },
    });
    expect(r.role).toBeNull();
    expect(r.roleReady).toBe(true); // 画面を止めない
    expect(r.roleError).toBe('権限の確認に失敗しました。');
  });

  it('別店舗の取得結果は使わない（店舗切替時の取り違え防止）', () => {
    const r = resolveShopRoleState({
      ...base,
      fetched: { shopId: 's2', role: 'manager', error: '別店舗のエラー' },
    });
    expect(r).toEqual({ role: null, roleReady: false, roleError: null });
  });

  it('オーナーには他店舗由来の roleError を持ち込まない', () => {
    const r = resolveShopRoleState({
      ...base,
      canManage: true,
      fetched: { shopId: 's1', role: null, error: 'なにか失敗' },
    });
    expect(r.roleError).toBeNull();
  });
});

describe('hasRole — 失敗時に許可へ倒さない', () => {
  it('オーナーは常に true', () => {
    expect(hasRole({ canManage: true, role: null }, ['manager'])).toBe(true);
  });

  it('該当ロールを持てば true / 持たなければ false', () => {
    expect(hasRole({ canManage: false, role: 'manager' }, ['manager', 'accounting'])).toBe(true);
    expect(hasRole({ canManage: false, role: 'cast' }, ['manager', 'accounting'])).toBe(false);
  });

  it('role 未解決（null）は false（取得失敗でも許可しない）', () => {
    expect(hasRole({ canManage: false, role: null }, ['manager'])).toBe(false);
  });
});
