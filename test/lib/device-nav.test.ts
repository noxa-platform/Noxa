import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveDeviceModules,
  resolveDeviceTabs,
  deviceGlyph,
  DEVICE_TAB_LIMIT,
  DEVICE_NO_MODULE_TEXT,
} from '../../src/lib/device-nav';
import { DEFAULT_MODULES } from '../../src/lib/shopConfig';

// 条件つきの到達性（Day113）: 店舗端末（kiosk）は「隠す」側だけが実装されており、
// **隠された端末が実際に何へ到達できるか**を誰も保証していなかった。
//   - スマホ幅ではサイドバー（hidden md:flex）が消え、下部タブも端末では非表示だった
//     ＝許可モジュールへの導線がゼロ。残るリンクはロゴの /account だけ。
//   - その /account は端末を判定せず、個人機能・プラン・「＋自分のお店を登録する」・
//     許可外モジュール全部を並べていた（隠したものがハブで再露出）。
//   - allowedModules が空の端末はナビが真っ白で理由も出なかった。
// ここは判定（純ロジック）と、端末が到達できる画面が判定を使っていることを固定する。

describe('resolveDeviceModules（端末の許可モジュール解決）', () => {
  it('allow の並びではなく DEFAULT_MODULES の正準順で返す', () => {
    const got = resolveDeviceModules(['attendance', 'pos', 'seating']);
    expect(got.map((m) => m.key)).toEqual(['pos', 'seating', 'attendance']);
  });

  it('href は /<key>（遷移先が src/app に実在すること）', () => {
    for (const m of resolveDeviceModules(DEFAULT_MODULES.map((d) => d.key))) {
      expect(m.href).toBe(`/${m.key}`);
      // 実在しない遷移先を端末に出すと、そのモジュールは 404 に着地する（Day112 と同じ理由）
      expect(existsSync(join(process.cwd(), 'src/app', m.key, 'page.tsx'))).toBe(true);
    }
  });

  it('未知のキーは落とす（404 になる導線を端末に出さない）', () => {
    expect(resolveDeviceModules(['pos', 'not-a-module', '']).map((m) => m.key)).toEqual(['pos']);
  });

  it('重複は 1 件に畳む', () => {
    expect(resolveDeviceModules(['pos', 'pos']).map((m) => m.key)).toEqual(['pos']);
  });

  it('空・未定義・非配列は空配列（UI 側は理由を出す）', () => {
    expect(resolveDeviceModules([])).toEqual([]);
    expect(resolveDeviceModules(undefined)).toEqual([]);
    expect(resolveDeviceModules(null)).toEqual([]);
    expect(resolveDeviceModules('pos' as unknown as string[])).toEqual([]);
    expect(DEVICE_NO_MODULE_TEXT.length).toBeGreaterThan(0);
  });

  it('許可を勝手に広げない（allow に無いモジュールは出さない）', () => {
    const got = resolveDeviceModules(['pos']);
    expect(got.some((m) => ['payroll', 'unpaid', 'risk'].includes(m.key))).toBe(false);
  });
});

describe('resolveDeviceTabs（モバイル下部タブ）', () => {
  it('先頭は必ずホーム（/account）＝タブから溢れたモジュールの到達手段', () => {
    const tabs = resolveDeviceTabs(resolveDeviceModules(['pos']));
    expect(tabs[0].href).toBe('/account');
  });

  it('上限を超えない。溢れた分はホーム（端末ホーム）から辿れる', () => {
    const all = resolveDeviceModules(DEFAULT_MODULES.map((d) => d.key));
    const tabs = resolveDeviceTabs(all);
    expect(tabs.length).toBe(DEVICE_TAB_LIMIT);
    expect(all.length).toBeGreaterThan(DEVICE_TAB_LIMIT);
    // 溢れたモジュールはタブに無いが、ホーム（/account の端末ホーム）が全件を出す
    expect(tabs.some((t) => t.href === all[all.length - 1].href)).toBe(false);
    expect(tabs[0].href).toBe('/account');
  });

  it('許可が空でもホームだけは残す（ナビが完全に消えない）', () => {
    expect(resolveDeviceTabs([]).map((t) => t.href)).toEqual(['/account']);
  });

  it('全モジュールにアイコンがある（• フォールバックに落ちない）', () => {
    for (const d of DEFAULT_MODULES) expect(deviceGlyph(d.key)).not.toBe('•');
    expect(deviceGlyph('home')).not.toBe('•');
  });
});

describe('端末が到達できる画面が判定を使っていること（静的ガード）', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('AccountShell が端末ナビを device-nav の判定から組み立てる', () => {
    const src = read('src/components/AccountShell.tsx');
    expect(src).toMatch(/resolveDeviceModules/);
    // 端末モードで下部タブを丸ごと消さない（スマホ幅で導線がゼロになった実バグ）
    expect(src).not.toMatch(/!device\.isDevice\s*&&\s*<BottomTabBar/);
    expect(src).toMatch(/resolveDeviceTabs/);
  });

  it('アカウントのハブ（/account）が端末を判定して許可モジュールのみ出す', () => {
    const src = read('src/app/account/page.tsx');
    // スマホ幅の端末にとってここが唯一の入口。個人機能や許可外モジュールを並べない
    expect(src).toMatch(/useDeviceClaims/);
    expect(src).toMatch(/resolveDeviceModules/);
  });
});
