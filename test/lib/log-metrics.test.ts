import { describe, expect, it } from 'vitest';
import { countsAsGroup } from '../../src/lib/log-metrics';
import { isCountedAsGroup } from '../../src/lib/types';

// 組数カウント判定の単一ソース（Day58）。
// member-stats API がインラインで `type === 'visit'` のみ見て outside を取りこぼし、
// 日次サマリ通知や types の正準ルールと食い違っていた回帰を固定する。

describe('countsAsGroup', () => {
  it('countAsGroup=true は type によらず対象', () => {
    expect(countsAsGroup('message', true)).toBe(true);
    expect(countsAsGroup('call', true)).toBe(true);
  });
  it('countAsGroup=false は type によらず対象外', () => {
    expect(countsAsGroup('visit', false)).toBe(false);
    expect(countsAsGroup('outside', false)).toBe(false);
  });
  it('未指定(旧データ)は visit を対象にする', () => {
    expect(countsAsGroup('visit', undefined)).toBe(true);
    expect(countsAsGroup('visit', null)).toBe(true);
  });
  it('未指定(旧データ)は outside も対象にする（旧 member-stats が取りこぼしていた分・回帰防止）', () => {
    expect(countsAsGroup('outside', undefined)).toBe(true);
    expect(countsAsGroup('outside', null)).toBe(true);
  });
  it('未指定かつ visit/outside 以外は対象外', () => {
    for (const t of ['douhan', 'call', 'message', 'after', 'other', undefined, null, '']) {
      expect(countsAsGroup(t, undefined), `type=${t}`).toBe(false);
    }
  });
});

describe('isCountedAsGroup は countsAsGroup に委譲（Web 側の単一ソース性）', () => {
  it('type/countAsGroup の全組み合わせで一致する', () => {
    const types = ['visit', 'outside', 'douhan', 'call', 'message', 'after', 'other'] as const;
    const flags = [true, false, undefined] as const;
    for (const t of types) {
      for (const f of flags) {
        expect(isCountedAsGroup({ type: t, countAsGroup: f })).toBe(countsAsGroup(t, f));
      }
    }
  });
});
