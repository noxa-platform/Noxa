import { describe, it, expect } from 'vitest';
import {
  mergeModules, resolveTerm, resolveIndustry, DEFAULT_MODULES, CORE_MODULE_KEYS,
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

  // ⚠️ **空の上書きは「呼び名が空」ではなく「上書きが無い」**（P153-PM16）。
  // 旧実装は `??` で繋いでおり `''` がそのまま返っていた。設定画面は入力欄を空にしたまま
  // 保存できるので、**その店だけラベルが消えた画面**になっていた。
  it('空文字・空白だけの上書きは次の段へ落ちる（ラベルを消さない）', () => {
    for (const blank of ['', '   ', '\n']) {
      const cfg = { terminology: { cast: blank } } as unknown as ShopConfig;
      expect(resolveTerm(cfg, 'ホストクラブ', 'cast')).toBe('ホスト'); // 業種プリセットへ
      expect(resolveTerm(cfg, undefined, 'cast')).toBe('キャスト');    // 既定へ
    }
  });

  it('文字列でない上書きも「無い」扱い（Firestore は型違いを保存できる）', () => {
    for (const bad of [0, 42, true, null, {}, ['ホスト']]) {
      const cfg = { terminology: { cast: bad } } as unknown as ShopConfig;
      expect(resolveTerm(cfg, undefined, 'cast')).toBe('キャスト');
    }
  });
});

describe('resolveIndustry — 業種の取り出し（P153-PM20）', () => {
  // ⚠️ **`businessCategory` は読み手ゼロのフィールドだった**。iOS のチュートリアルは
  // 業種を必須で聞いてそこへ保存しており、入れた値が業種プリセットにもテーマにも
  // AI の店舗ヒントにも一度も効いていなかった（yorulog `d20cf02` で iOS 側は是正済み）。
  // **配布済みの古いビルドは今も `businessCategory` にしか書かない**ので読み側で拾う。
  it('storeTypeName を優先し、無ければ businessCategory から拾う', () => {
    expect(resolveIndustry({ storeTypeName: 'ホストクラブ' })).toBe('ホストクラブ');
    expect(resolveIndustry({ businessCategory: 'キャバクラ' })).toBe('キャバクラ');
    expect(resolveIndustry({ storeTypeName: 'ラウンジ', businessCategory: 'スナック' })).toBe('ラウンジ');
  });

  // ⚠️ 空文字は「業種が空である」ではなく「入っていない」（PM16 と同じ判断）
  it('空文字・空白だけの storeTypeName は businessCategory へ落ちる', () => {
    expect(resolveIndustry({ storeTypeName: '', businessCategory: 'スナック' })).toBe('スナック');
    expect(resolveIndustry({ storeTypeName: '   ', businessCategory: 'スナック' })).toBe('スナック');
  });

  // ⚠️ 前後の空白で「AI のヒントは効くのに呼び名とテーマは効かない」割れ方をしていた
  it('前後の空白を落とす（完全一致で照合する側と、緩く見る側を揃える）', () => {
    expect(resolveIndustry({ storeTypeName: ' ホストクラブ ' })).toBe('ホストクラブ');
    expect(resolveTerm(null, resolveIndustry({ storeTypeName: 'ホストクラブ ' }), 'cast')).toBe('ホスト');
  });

  it('どちらも無い・型違いなら undefined（既定へ落ちる）', () => {
    expect(resolveIndustry({})).toBeUndefined();
    expect(resolveIndustry(null)).toBeUndefined();
    expect(resolveIndustry({ storeTypeName: 42, businessCategory: {} })).toBeUndefined();
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
