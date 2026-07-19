import { describe, it, expect } from 'vitest';
import {
  mergeModules, resolveTerm, DEFAULT_MODULES, CORE_MODULE_KEYS,
  type ShopConfig,
} from '../../src/lib/shopConfig';

// 店舗設定の純ロジック（用語解決・モジュール構成マージ）の回帰。

describe('resolveTerm — 用語解決のフォールバック連鎖', () => {
  it('店舗上書き → 業種プリセット → 既定 → キー自身 の順', () => {
    const cfg = { terminology: { cast: 'ボーイ' } } as unknown as ShopConfig;
    // 店舗上書きが最優先
    expect(resolveTerm(cfg, 'ホストクラブ', 'cast')).toBe('ボーイ');
    // 上書きが無ければ業種プリセット（ホストクラブ: cast=ホスト）
    expect(resolveTerm(null, 'ホストクラブ', 'cast')).toBe('ホスト');
    // 業種にも無ければ既定
    expect(resolveTerm(null, 'ホストクラブ', 'checkout')).toBe('会計');
    // どこにも無ければキー自身を返す
    expect(resolveTerm(null, undefined, 'unknown_key')).toBe('unknown_key');
  });

  it('config が null / 業種が undefined でも既定へ落ちる', () => {
    expect(resolveTerm(null, undefined, 'cast')).toBe('キャスト');
  });
});

describe('mergeModules — 既定とのマージ', () => {
  it('空 cfg は全既定モジュールを補完し、コアのみ有効', () => {
    const out = mergeModules([]);
    expect(out.length).toBe(DEFAULT_MODULES.length);
    for (const m of out) {
      expect(m.enabled).toBe(CORE_MODULE_KEYS.has(m.key));
    }
  });

  it('未知キーは落とす（削除済みモジュールの掃除）', () => {
    const out = mergeModules([{ key: 'zzz_removed', enabled: true }]);
    expect(out.some((m) => m.key === 'zzz_removed')).toBe(false);
    expect(out.length).toBe(DEFAULT_MODULES.length);
  });

  it('保存済みモジュールの enabled と並びを保持し、欠落を末尾補完', () => {
    // 既知の非コアモジュールを1つだけ有効化して渡す
    const nonCore = DEFAULT_MODULES.find((d) => !CORE_MODULE_KEYS.has(d.key))!;
    const out = mergeModules([{ key: nonCore.key, enabled: true }]);
    expect(out.find((m) => m.key === nonCore.key)?.enabled).toBe(true);
    expect(out.length).toBe(DEFAULT_MODULES.length);
  });

  // ─ Day53 回帰: 重複キーを先勝ちで畳む（保存データ破損での二重表示防止）─
  it('重複キーは1つに畳む（先勝ち）', () => {
    const out = mergeModules([
      { key: 'pos', enabled: true },
      { key: 'pos', enabled: false },
    ]);
    const posEntries = out.filter((m) => m.key === 'pos');
    expect(posEntries).toHaveLength(1);
    expect(posEntries[0].enabled).toBe(true); // 先勝ち
    // 全体としても既定数を超えない（重複が残っていない）
    expect(out.length).toBe(DEFAULT_MODULES.length);
  });
});
