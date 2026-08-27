import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeConfigFallback } from '@/lib/shopConfig';

// P159: 店舗設定を読めなくても画面は既定値で動く（止めると何も使えない）。
// ⚠️ 問題は**その既定値が「この店の呼び名」の顔で出る**こと。ホストクラブなのに「キャスト」と
// 表示され、**利用者には設定なのか読めなかった結果なのか区別が付かない**。
// これまで `configError` を見ていたのは**設定画面だけ**で（既定値での上書き保存を防ぐため）、
// 呼び名を実際に表示する他の全画面は**黙って既定を出していた**。
// ＝「対処の存在は網羅の証拠にならない」の再演（今週 6 回目）。

describe('describeConfigFallback — 既定で表示していることを言う', () => {
  it('読めていれば何も言わない（常時バナーにしない）', () => {
    expect(describeConfigFallback(null, null)).toBeNull();
    expect(describeConfigFallback(undefined, undefined)).toBeNull();
  });

  it('設定 doc が読めないときは「呼び名もモジュールも既定」と言う', () => {
    const m = describeConfigFallback('権限がありません', null);
    expect(m).toContain('既定値');
    // ⚠️ 設定が消えたと誤解されるのが一番まずい
    expect(m).toContain('消えたわけではありません');
  });

  // ⚠️ 2 つの失敗を**畳まない**（P154-PM2 の「捨てる前に理由を分ける」と同じ）。
  // 設定が読めない＝呼び名もモジュールも既定 ／ 業種が読めない＝上書きは効くが業種プリセットが当たらない
  it('業種だけ読めないときは別の説明にする', () => {
    const cfgDown = describeConfigFallback('通信に失敗', null);
    const industryDown = describeConfigFallback(null, '通信に失敗');
    expect(industryDown).not.toBeNull();
    expect(industryDown).not.toBe(cfgDown);
    expect(industryDown).toContain('業種');
  });

  it('設定 doc の失敗を優先する（両方落ちていれば影響の大きい方を言う）', () => {
    expect(describeConfigFallback('A', 'B')).toBe(describeConfigFallback('A', null));
  });

  // ⚠️ yorulog の `TerminologyPlan` と揃える。対処が「設定する」と「開き直す」で全く違うので、
  // 「設定されていません」と言うと利用者は設定しに行ってしまう
  it('「設定されていません」とは言わない（対処が別物）', () => {
    for (const m of [describeConfigFallback('x', null), describeConfigFallback(null, 'x')]) {
      expect(m).not.toContain('設定されていません');
    }
  });
});

// 呼び名を出す全画面が通る入口（AccountShell）で言えていること。
// ここを外すと、また設定画面だけが知っている状態に戻る
describe('全画面の入口で言っている', () => {
  const SHELL = 'src/components/AccountShell.tsx';
  const src = readFileSync(SHELL, 'utf8');

  it('走査対象が取れている（空振り防止）', () => {
    expect(src).toContain('useShopConfig');
    expect(src.length).toBeGreaterThan(1000);
  });

  it('AccountShell が configNotice を表示している', () => {
    expect(src).toContain('cfg.configNotice');
    expect(src).toMatch(/role="alert"[\s\S]{0,400}cfg\.configNotice|cfg\.configNotice[\s\S]{0,400}role="alert"/);
  });
});
