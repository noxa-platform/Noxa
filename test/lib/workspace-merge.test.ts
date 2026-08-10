import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeWorkspaces, pickActiveId, pickShopId } from '../../src/lib/workspace';

// ワークスペース切替の「到達性」（Day105）。
// WorkspaceSwitcher は items が空だと丸ごと非表示になるため、一覧の組み立てが
// 1件の読み取り失敗で空に潰れると、個人ワークスペース選択中のユーザーは
// 自分の店に戻る手段を失う（サイドバーの店舗ナビは shopId 未選択では出ない）。

describe('mergeWorkspaces（所有＋所属の畳み込み）', () => {
  it('所有店舗は owner・所属店舗は member として並ぶ（所有が先）', () => {
    expect(mergeWorkspaces([{ id: 'o1', name: '本店' }], [{ id: 'm1', name: '系列店' }])).toEqual([
      { id: 'o1', name: '本店', role: 'owner' },
      { id: 'm1', name: '系列店', role: 'member' },
    ]);
  });

  it('同じ店舗が両方に出ても owner として1件だけ（CF が所有店も memberships に同期する）', () => {
    expect(mergeWorkspaces([{ id: 's1', name: '本店' }], [{ id: 's1', name: '本店' }])).toEqual([
      { id: 's1', name: '本店', role: 'owner' },
    ]);
  });

  it('★店舗名が取れなくても要素は落とさない（名前は ID にフォールバック）', () => {
    // shopName 未設定の古い memberships / 店舗 doc の取得失敗でも、切替先としては残す。
    // ここで要素ごと落とすと「名前が引けない店には二度と戻れない」行き止まりになる。
    expect(mergeWorkspaces([], [{ id: 'm1' }, { id: 'm2', name: null }, { id: 'm3', name: '' }])).toEqual([
      { id: 'm1', name: 'm1', role: 'member' },
      { id: 'm2', name: 'm2', role: 'member' },
      { id: 'm3', name: 'm3', role: 'member' },
    ]);
  });

  it('どちらも空なら空（個人のみのユーザー＝切替不要）', () => {
    expect(mergeWorkspaces([], [])).toEqual([]);
  });
});

describe('pickActiveId（localStorage の選択値の解決）', () => {
  it('personal を明示していれば personal のまま（店舗があっても勝手に店へ移さない）', () => {
    expect(pickActiveId(['s1'], 'personal')).toBe('personal');
  });

  it('実在する選択はそのまま尊重', () => {
    expect(pickActiveId(['s1', 's2'], 's2')).toBe('s2');
  });

  it('もう所属していない店舗が選択されていたら先頭店舗へ退避（存在しない ID に固定されない）', () => {
    expect(pickActiveId(['s1'], 'gone')).toBe('s1');
  });

  it('未選択かつ店舗なしは personal', () => {
    expect(pickActiveId([], null)).toBe('personal');
  });
});

describe('pickShopId（操作対象の解決・既存契約の固定）', () => {
  it('personal 選択中は shopId なし＝店舗モジュールは出ない', () => {
    expect(pickShopId(['o1'], [], 'personal')).toEqual({ shopId: null, isOwner: false });
  });

  it('所属だけのキャストでも操作対象は解決する（owner ではない）', () => {
    expect(pickShopId([], ['m1'], null)).toEqual({ shopId: 'm1', isOwner: false });
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('静的ガード（1件の読み取り失敗で全ワークスペースが消える構造への逆戻りを検出）', () => {
  it('useWorkspaces は読み取りを個別に握る（全体を包む try/catch に戻さない）', () => {
    const body = read('src/lib/workspace.ts').split('export function useWorkspaces')[1];
    expect(body).toBeTruthy();
    // 失敗を要素ごとに閉じ込める `.catch(` が読み取りの数だけある
    expect((body.match(/\.catch\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // 読み込み完了として一覧全体を空にして返す退避パスが無い（初期 loading:true の空は可）
    expect(body).not.toContain('loading: false, items: []');
  });

  it('所属店舗名は memberships の denormalize（shopName）を先に使う', () => {
    const body = read('src/lib/workspace.ts').split('export function useWorkspaces')[1];
    expect(body).toContain('shopName');
  });

  it('useShopContext も所有クエリと所属クエリを独立させている', () => {
    const src = read('src/lib/useShopContext.ts');
    const body = src.split('export function useShopContext')[1];
    expect((body.match(/\.catch\(\(\) => null\)/g) ?? []).length).toBe(2);
  });
});
