import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// AI 緊急停止スイッチ（2026-08-25・予算逼迫による緊急対応）。
//
// 出回っているクライアント（iOS 1.0 / 1.1 / Web / nomishugy）はコード変更が間に合わないため、
// 止められるのはサーバだけ。ここが誤ると**課金が止まらない**ので挙動を厳密に固定する。

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));

import {
  getAiKillSwitch, aiKillSwitchResponse, assertAiEnabled,
  AiDisabledError, resetAiKillSwitchCache,
} from '../../src/app/api/lib/ai-kill-switch';

/** global_settings/ai_kill_switch と account_subscriptions/{uid} だけ持つ最小フェイク */
function makeDb(docs: Record<string, Record<string, unknown> | undefined>) {
  return {
    doc: (path: string) => ({
      get: async () => {
        if (docs[path] === undefined) return { exists: false, data: () => undefined };
        return { exists: true, data: () => docs[path] };
      },
    }),
  };
}
function makeFailingDb() {
  return { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
}

const SWITCH_PATH = 'global_settings/ai_kill_switch';

beforeEach(() => {
  resetAiKillSwitchCache();
  mocks.getDb.mockReset();
  delete process.env.AI_KILL_SWITCH;
});
afterEach(() => { process.env.AI_KILL_SWITCH = '0'; });

describe('既定は停止（fail-closed）', () => {
  // 予算の止血が目的。「設定を作り忘れたので動き続けていた」を作らない
  it('doc が無ければ停止', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    expect((await getAiKillSwitch()).disabled).toBe(true);
  });

  it('Firestore が読めず、一度も読めていなければ停止', async () => {
    mocks.getDb.mockReturnValue(makeFailingDb());
    expect((await getAiKillSwitch()).disabled).toBe(true);
  });

  it('disabled を明示的に false と書いたときだけ動く', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    expect((await getAiKillSwitch()).disabled).toBe(false);
  });

  it('disabled が未設定・null・文字列なら停止のまま（曖昧な値で再開しない）', async () => {
    for (const v of [undefined, null, 'false', 0]) {
      resetAiKillSwitchCache();
      mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: v } }));
      expect((await getAiKillSwitch()).disabled).toBe(true);
    }
  });

  // 一時障害のたびに停止/再開が揺れると運用が読めなくなる
  it('一度読めた後の障害では直前の値を使う', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    expect((await getAiKillSwitch()).disabled).toBe(false);
    mocks.getDb.mockReturnValue(makeFailingDb());
    expect((await getAiKillSwitch()).disabled).toBe(false);
  });
});

describe('env による上書き（Firestore を読まない）', () => {
  it('AI_KILL_SWITCH=1 は即停止', async () => {
    process.env.AI_KILL_SWITCH = '1';
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    expect((await getAiKillSwitch()).disabled).toBe(true);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('AI_KILL_SWITCH=0 は動作（テスト・ローカル用）', async () => {
    process.env.AI_KILL_SWITCH = '0';
    mocks.getDb.mockReturnValue(makeDb({}));
    const s = await getAiKillSwitch();
    expect(s.disabled).toBe(false);
    expect(s.stopFreeCreditGrants).toBe(false);
  });
});

describe('返すレスポンス（iOS がそのまま画面に出す）', () => {
  it('停止中は 503（429 は使わない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    const res = await aiKillSwitchResponse('u1');
    expect(res?.status).toBe(503);
    // 429 は iOS が insufficientCredits として残高表示を書き換えてしまう
    expect(res?.status).not.toBe(429);
  });

  it('error に日本語の説明が入る（これが実質の UI）', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('一時停止');
    expect(body.error.length).toBeGreaterThan(10);
  });

  it('creditsRemaining を返さない（残高表示を壊さない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.creditsRemaining).toBeUndefined();
    expect(body.requiredCredits).toBeUndefined();
  });

  it('文言は doc で差し替えられる（再デプロイ無しで変えられる）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, message: '独自の文言' } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.error).toBe('独自の文言');
  });

  it('動作中は null を返す（呼び出し側は素通り）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    expect(await aiKillSwitchResponse('u1')).toBeNull();
  });
});

// 「お金を払ったのに使えない」を避ける運用（案 a）。既定は全員停止で、doc で切り替える
describe('購入済みクレジット保持者だけ通す運用', () => {
  const on = { disabled: true, allowPurchasedCredits: true };

  it('既定（allowPurchasedCredits 未設定）では購入者も止まる', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true },
      'account_subscriptions/u1': { purchasedCredits: 500 },
    }));
    expect((await aiKillSwitchResponse('u1'))?.status).toBe(503);
  });

  it('有効にすると購入済み残高がある人は通る', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: on,
      'account_subscriptions/u1': { purchasedCredits: 500 },
    }));
    expect(await aiKillSwitchResponse('u1')).toBeNull();
  });

  it('残高 0 / doc 無しの人は止まる', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: on, 'account_subscriptions/u1': { purchasedCredits: 0 } }));
    expect((await aiKillSwitchResponse('u1'))?.status).toBe(503);
    resetAiKillSwitchCache();
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: on }));
    expect((await aiKillSwitchResponse('u2'))?.status).toBe(503);
  });

  it('購入者向けの文言は「残高は保持される」と伝える', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.error).toContain('残高');
  });

  it('uid が無ければ通さない（匿名で素通りできない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: on }));
    expect((await aiKillSwitchResponse())?.status).toBe(503);
  });
});

describe('assertAiEnabled — プロバイダ直前の最後の砦', () => {
  it('停止中は AiDisabledError を投げる（外部 API を叩かない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    await expect(assertAiEnabled()).rejects.toBeInstanceOf(AiDisabledError);
  });
  it('動作中は通す', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    await expect(assertAiEnabled()).resolves.toBeUndefined();
  });
});

// ここが本丸。1 箇所でも漏れると課金が止まらない
describe('外部 API を叩く経路がすべてスイッチを通る', () => {
  it('OpenRouter を叩く 2 関数の両方に assertAiEnabled がある', () => {
    const src = readFileSync('src/app/api/ai/openrouter.ts', 'utf8');
    // fetch(OR_ENDPOINT) の回数と assertAiEnabled の回数が一致すること
    const fetches = [...src.matchAll(/fetch\(OR_ENDPOINT/g)].length;
    const guards = [...src.matchAll(/await assertAiEnabled\(\)/g)].length;
    expect(fetches).toBeGreaterThan(0);
    expect(guards).toBe(fetches);
  });

  it('ai-provider の公開関数がすべてスイッチを通る', () => {
    const src = readFileSync('src/app/api/ai/ai-provider.ts', 'utf8');
    const fns = [...src.matchAll(/export async function \w+/g)].length;
    const guards = [...src.matchAll(/await assertAiEnabled\(\)/g)].length;
    expect(guards).toBe(fns);
  });

  // benchmark は ai-provider も openrouter.ts も経由せず自前で fetch する
  it('OpenRouter を直接叩く route はスイッチを通している', () => {
    const API_ROOT = join(process.cwd(), 'src/app/api');
    const files: string[] = [];
    (function walk(d: string) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name === 'route.ts') files.push(f);
      }
    })(API_ROOT);

    const direct = files.filter((f) => /openrouter\.ai\/api/.test(readFileSync(f, 'utf8')));
    expect(direct.length).toBeGreaterThan(0); // 検出ロジックの番人
    const unguarded = direct
      .filter((f) => !/aiKillSwitchResponse\(|assertAiEnabled\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(API_ROOT, f).split(/[\\/]/).join('/'));
    expect(unguarded).toEqual([]);
  });
});

describe('無料クレジットの配布停止', () => {
  it('既定で配布を止める', async () => {
    mocks.getDb.mockReturnValue(makeDb({}));
    expect((await getAiKillSwitch()).stopFreeCreditGrants).toBe(true);
  });
  it('明示的に false のときだけ配る', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false, stopFreeCreditGrants: false } }));
    expect((await getAiKillSwitch()).stopFreeCreditGrants).toBe(false);
  });
});
