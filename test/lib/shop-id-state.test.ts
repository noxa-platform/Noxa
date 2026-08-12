import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveShopIdState, describeMissingShop, SHOP_NOT_FOUND_TEXT } from '../../src/lib/shop-id-state';

// 「読み取り失敗」と「店舗に所属していない」を混ぜないための判定（Day109）。
//
// 旧実装（useShopId / POS / 席回し / 勤怠 / 給与に同じものが5つ複製されていた）は
//   try { 所有クエリ; 所属クエリ } catch { shopId = null }
// だったため、通信断やオフライン復帰直後に 11 画面が「所属店舗が見つかりません」と言い切っていた。
// 在籍中のスタッフが未所属に見え、打刻・POS・在庫が丸ごと開けない（原因表示も無い）。

describe('resolveShopIdState（読み取り失敗を「未所属」と混ぜない）', () => {
  it('両方読めたら従来どおり pickShopId の結果（オーナー店舗が優先）', () => {
    expect(resolveShopIdState({ owned: ['s1'], memberships: ['s2'], active: null }))
      .toEqual({ shopId: 's1', isOwner: true, unresolved: false });
  });

  it('所属だけのメンバーも解決できる（isOwner=false）', () => {
    expect(resolveShopIdState({ owned: [], memberships: ['s2'], active: null }))
      .toEqual({ shopId: 's2', isOwner: false, unresolved: false });
  });

  it('本当にどこにも所属していなければ unresolved=false のまま shopId=null（＝未所属の確定）', () => {
    expect(resolveShopIdState({ owned: [], memberships: [], active: null }))
      .toEqual({ shopId: null, isOwner: false, unresolved: false });
  });

  it('個人ワークスペースの明示選択は失敗ではない（unresolved=false）', () => {
    expect(resolveShopIdState({ owned: null, memberships: null, active: 'personal' }))
      .toEqual({ shopId: null, isOwner: false, unresolved: false });
  });

  it('★両方の読み取りに失敗したら unresolved=true（「未所属」と言い切らない）', () => {
    expect(resolveShopIdState({ owned: null, memberships: null, active: null }))
      .toEqual({ shopId: null, isOwner: false, unresolved: true });
  });

  it('★所有クエリが読めないときは、所属が読めていても確定しない（オーナーの管理操作が黙って消えるため）', () => {
    expect(resolveShopIdState({ owned: null, memberships: ['s2'], active: 's2' }))
      .toEqual({ shopId: null, isOwner: false, unresolved: true });
  });

  it('★所属クエリだけ失敗＋アクティブ選択が所有に無い場合は確定しない（黙って別の店舗を開かない）', () => {
    // 旧実装は memberships を「空」として扱い、選択中の s2（所属店舗）ではなく s1 を開いていた
    expect(resolveShopIdState({ owned: ['s1'], memberships: null, active: 's2' }))
      .toEqual({ shopId: null, isOwner: false, unresolved: true });
  });

  it('所属クエリが失敗しても、結論が所有だけで決まるなら確定する（不要に劣化させない）', () => {
    expect(resolveShopIdState({ owned: ['s1'], memberships: null, active: null }))
      .toEqual({ shopId: 's1', isOwner: true, unresolved: false });
    expect(resolveShopIdState({ owned: ['s1', 's3'], memberships: null, active: 's3' }))
      .toEqual({ shopId: 's3', isOwner: true, unresolved: false });
  });

  it('所属クエリが失敗し所有が空なら確定しない（「未所属」に見えるのは所属が読めていないだけ）', () => {
    expect(resolveShopIdState({ owned: [], memberships: null, active: null }))
      .toEqual({ shopId: null, isOwner: false, unresolved: true });
  });

  it('失敗時に権限を広げない（unresolved のとき isOwner は必ず false）', () => {
    for (const src of [
      { owned: null, memberships: null, active: null },
      { owned: null, memberships: ['s1'], active: 's1' },
      { owned: [], memberships: null, active: null },
    ] as const) {
      expect(resolveShopIdState(src).isOwner).toBe(false);
    }
  });
});

describe('describeMissingShop（画面文言の単一入口）', () => {
  it('確認できていれば従来どおり「所属店舗が見つかりません。」', () => {
    expect(describeMissingShop(null)).toBe(SHOP_NOT_FOUND_TEXT);
  });

  it('画面ごとの補足文言を渡せる（給与などの案内を残す）', () => {
    expect(describeMissingShop(null, '所属店舗が見つかりません。店舗に所属すると給与明細が表示されます。'))
      .toContain('給与明細');
  });

  it('★確認に失敗しているときは「未所属」と言い切らず、理由と再読み込みを案内する', () => {
    const msg = describeMissingShop('店舗情報の取得に失敗しました。通信できませんでした。（unavailable）');
    expect(msg).toContain('通信できませんでした');
    expect(msg).toContain('再読み込み');
    expect(msg).not.toBe(SHOP_NOT_FOUND_TEXT);
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

// shopId を解決するコードは複数箇所にある（フック／POS／席回し／勤怠／給与）。
// 1か所でも旧来の「まとめて try → catch で null」に戻ると、その画面だけ静かに未所属表示へ退化する。
const RESOLVERS = [
  'src/lib/useShopId.ts',
  'src/lib/pos/store.ts',
  'src/lib/seating/store.ts',
  'src/components/modules/attendance/AttendanceClient.tsx',
  'src/components/modules/payroll/PayrollClient.tsx',
];

describe('静的ガード（shopId 解決の退化を検出）', () => {
  it('shopId を解決する箇所はすべて resolveShopIdState を通す', () => {
    const offenders = RESOLVERS.filter((p) => !read(p).includes('resolveShopIdState'));
    expect(offenders).toEqual([]);
  });

  it('所有クエリと所属クエリを独立して catch している（片方の失敗で結論を黙って変えない）', () => {
    const offenders: string[] = [];
    for (const p of RESOLVERS) {
      const src = read(p);
      // `getDocs(...).then(...).catch(...)` の形が2つ（所有・所属）あること
      const guarded = (src.match(/getDocs\([\s\S]{0,200}?\.catch\(/g) ?? []).length;
      if (guarded < 2) offenders.push(`${p}（${guarded}件）`);
    }
    expect(offenders).toEqual([]);
  });

  it('「所属店舗が見つかりません」は文言ヘルパー経由でしか出さない（確認失敗との混同を防ぐ）', () => {
    // 画面に直書きすると、確認できなかっただけの状態でも未所属と言い切ってしまう
    const files = [
      'src/components/modules/transport/TransportClient.tsx',
      'src/components/modules/unpaid/UnpaidClient.tsx',
      'src/components/modules/inventory/InventoryClient.tsx',
      'src/components/modules/risk/RiskClient.tsx',
      'src/components/modules/reservation/ReservationClient.tsx',
      'src/components/modules/trial/TrialClient.tsx',
      'src/components/modules/first-visit/FirstVisitClient.tsx',
      'src/components/modules/first-visit/FirstVisitSettingsClient.tsx',
      'src/components/modules/attendance/AttendanceClient.tsx',
    ];
    const offenders = files.filter((p) => read(p).includes(SHOP_NOT_FOUND_TEXT));
    expect(offenders).toEqual([]);
  });
});
