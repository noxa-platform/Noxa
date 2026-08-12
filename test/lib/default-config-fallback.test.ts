import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 「読み取り失敗を**既定値**として静かに確定する」経路のガード（Day110）。
//
// Day106〜109 で潰した無音（書き込み／一覧／権限／店舗の確認）の最後の裾野。
// 空表示ではなく**既定値**に落ちるため、画面は正常に見えるのに中身が店舗のものではない:
//   1. 伝票計算（CalcClient）が `pos_config` を読めないと**既定料金で計算を続行**する
//      → 現場は「自店の料金で試算した」と信じて**別の金額**を客に伝える（無音の誤答）。
//   2. 店舗設定（useShopConfig）は購読エラーで DEFAULT_CONFIG を確定する。表示だけなら劣化で済むが、
//      **設定画面のフォームがその既定値で初期化され、保存すると店舗の設定が既定値で上書き**される
//      （用語・モジュール構成・ロール時給・送迎タイプ・在庫カテゴリが消える＝データ喪失）。
//
// UI 層のため実描画は testing-library 未導入で書けない（docs/ui-regression-test-options.md）。
// ここでは「その分岐が存在すること」を構造として固定する。

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('伝票計算: 料金設定が読めないときに既定料金で計算しない', () => {
  const src = read('src/components/modules/personal-calc/CalcClient.tsx');

  it('pos_config の取得失敗を握り潰さない（旧: catch { /* default */ }）', () => {
    expect(src).not.toMatch(/catch\s*\{\s*\/\*\s*default\s*\*\/\s*\}/);
    expect(src).toContain("describeFirestoreError(e, '料金設定の読み込み')");
  });

  it('失敗時は config を null のままにして計算機を描画しない', () => {
    // 「読めなかった」を既定値で埋めると、金額の誤りが画面に出ない
    expect(src).toMatch(/let cfg: StoreConfig \| null = null;/);
    expect(src).toMatch(/if \(!cfg\) return;/);
    expect(src).toMatch(/if \(cfgError\) \{/);
  });

  it('doc 未作成（店舗が料金未設定）は従来どおり既定でよい＝過剰に止めない', () => {
    expect(src).toMatch(/snap\.exists\(\)[\s\S]{0,200}createDefaultStoreConfig\('active'\)/);
  });

  it('所属店舗の解決失敗を「未所属」と言い切らない（Day109 と同じ規律）', () => {
    expect(src).not.toMatch(/catch\s*\{\s*\/\*\s*skip\s*\*\/\s*\}/);
    expect(src).toContain('shopsError');
  });
});

describe('店舗設定: 読めていない既定値で上書き保存させない', () => {
  const hook = read('src/lib/shopConfig.ts');
  const page = read('src/app/store/settings/page.tsx');

  it('useShopConfig は購読エラーの理由を configError として返す', () => {
    expect(hook).toContain('configError');
    expect(hook).toContain("describeFirestoreError(e, '店舗設定の読み込み')");
    // 成功時は必ず消える（前の失敗が残ると設定画面が永久に開けなくなる）
    expect(hook).toMatch(/setCfgSnap\(\{ shopId: sid, error: undefined, config: \{/);
  });

  it('★設定画面は configError がある間フォームを描画しない（既定値での上書き防止）', () => {
    const gate = page.indexOf('if (configError) {');
    const form = page.indexOf('<SettingsForm');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(form);
  });

  it('設定の保存失敗を無音にしない（旧: catch 無しで finally のみ）', () => {
    expect(page).toContain("describeFirestoreError(e, '店舗設定の保存')");
    expect(page).toContain('saveError');
  });
});

// バグハント（Day110・1回転）で見つけた同型。CalcClient（試算）より重い——POS は**実際の会計**で、
// 既定料金で切った伝票の金額がそのまま sales に記録される。
describe('POS: 料金設定が読めないときに既定料金で会計させない', () => {
  const store = read('src/lib/pos/store.ts');
  const client = read('src/components/modules/pos/PosClient.tsx');

  it('pos_config の取得失敗を握り潰さず configError として返す', () => {
    expect(store).toContain("describeFirestoreError(e, '料金設定の読み込み')");
    expect(store).toContain('configError');
    // 成功時に消える（前の失敗が残ると POS が開けなくなる）
    expect(store).toContain('setConfigError(null)');
  });

  it('★configError がある間は POS 画面を開かない', () => {
    expect(client).toContain('store.configError');
    const gate = client.indexOf('if (store.configError) {');
    const menu = client.indexOf('const menuItemsByName');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(menu);
  });

  it('店舗を確認できていないときに「店舗を登録」を促さない（Day109 の規律）', () => {
    const err = client.indexOf('store.error');
    const cta = client.indexOf('POS は店舗運営機能です');
    expect(err).toBeGreaterThanOrEqual(0);
    expect(err).toBeLessThan(cta);
  });
});

describe('一覧の読み取り失敗を「予定なし」と混ぜない', () => {
  it('個人スケジュールは読み取り失敗を画面に出す', () => {
    const src = read('src/components/modules/schedule/ScheduleClient.tsx');
    expect(src).toContain("describeFirestoreError(e, '予定の読み込み')");
    // 初回ロードと再読込の**両方**（片方だけだと操作後に理由が消える）
    expect((src.match(/予定の読み込み/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('勤怠のシフトカレンダーは出勤予定の読み取り失敗を画面に出す', () => {
    const src = read('src/components/modules/attendance/AttendanceClient.tsx');
    expect(src).toContain("describeFirestoreError(e, '出勤予定の読み込み')");
    expect((src.match(/出勤予定の読み込み/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
