import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// AI 緊急停止スイッチ（2026-08-25・予算逼迫による緊急対応）。
//
// 出回っているクライアント（iOS 1.0 / 1.1 / Web / nomishugy）はコード変更が間に合わないため、
// 止められるのはサーバだけ。ここが誤ると**課金が止まらない**ので挙動を厳密に固定する。

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getAuth: vi.fn(), getUser: vi.fn() }));
vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  getAdminDb: mocks.getDb,
  getAdminAuth: mocks.getAuth,
  AuthError: class AuthError extends Error {},
}));

import {
  getAiKillSwitch, aiKillSwitchResponse, assertAiEnabled,
  AiDisabledError, resetAiKillSwitchCache, resetAiExemptionCache, AI_DISABLED_CODE,
} from '../../src/app/api/lib/ai-kill-switch';
import { enterAiRequest } from '../../src/app/api/lib/ai-request-context';

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
/** どの doc を何回読んだかを数えるフェイク（安全網が読み直していないことの確認用） */
function makeCountingDb(docs: Record<string, Record<string, unknown> | undefined>) {
  const reads = { subscription: 0, switch: 0 };
  const db = {
    doc: (path: string) => ({
      get: async () => {
        if (path.startsWith('account_subscriptions/')) reads.subscription++;
        else if (path === 'global_settings/ai_kill_switch') reads.switch++;
        if (docs[path] === undefined) return { exists: false, data: () => undefined };
        return { exists: true, data: () => docs[path] };
      },
    }),
  };
  return { db, reads };
}
function makeFailingDb() {
  return { doc: () => ({ get: async () => { throw new Error('firestore down'); } }) };
}

const SWITCH_PATH = 'global_settings/ai_kill_switch';

beforeEach(() => {
  resetAiKillSwitchCache();
  resetAiExemptionCache();
  mocks.getDb.mockReset();
  mocks.getUser.mockReset();
  mocks.getAuth.mockReset().mockReturnValue({ getUser: mocks.getUser });
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
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false } }));
    const res = await aiKillSwitchResponse('u1');
    expect(res?.status).toBe(503);
    // 429 は iOS が insufficientCredits として残高表示を書き換えてしまう
    expect(res?.status).not.toBe(429);
  });

  it('error に日本語の説明が入る（これが実質の UI）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('一時停止');
    expect(body.error.length).toBeGreaterThan(10);
  });

  // ホスティング側の一時障害も 503 を返しうる。取り違えると障害中に
  // 「AI 一時停止しています」という嘘の説明をしてしまうので、機械可読な印で分ける
  it('停止であることを code で示す（障害の 503 と区別できる）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.code).toBe(AI_DISABLED_CODE);
    expect(AI_DISABLED_CODE).toBe('AI_DISABLED');
  });

  it('購入者向けの応答にも同じ code が入る', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true } }));
    const body = await (await aiKillSwitchResponse('u-nopurchase'))!.json();
    expect(body.code).toBe(AI_DISABLED_CODE);
  });

  it('creditsRemaining を返さない（残高表示を壊さない）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.creditsRemaining).toBeUndefined();
    expect(body.requiredCredits).toBeUndefined();
  });

  it('文言は doc で差し替えられる（再デプロイ無しで変えられる）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false, message: '独自の文言' },
    }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.error).toBe('独自の文言');
  });

  // iOS ではこの文言がユーザーの読む唯一の説明になる。
  // 「AI が止まった」を「アプリが壊れた」と受け取られないようにする
  it('既定文言は「AI 以外は使える」ことを伝える', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false } }));
    const body = await (await aiKillSwitchResponse('u1'))!.json();
    expect(body.error).toContain('AI 以外の機能');
    expect(body.error).toContain('通常どおり');
  });

  it('動作中は null を返す（呼び出し側は素通り）', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { disabled: false } }));
    expect(await aiKillSwitchResponse('u1')).toBeNull();
  });
});

// 「お金を払ったのに使えない」を避ける運用（案 a）。既定は全員停止で、doc で切り替える
describe('購入済みクレジット保持者だけ通す運用', () => {
  const on = { disabled: true, allowPurchasedCredits: true };

  // ユーザー決定（2026-08-25・案 a）: 支払い済みの対価は履行する。
  // 設定 doc を作り忘れても「金を払ったのに使えない」にならないよう既定側に埋めてある
  it('既定（allowPurchasedCredits 未設定）でも購入者は通る', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true },
      'account_subscriptions/u1': { purchasedCredits: 500 },
    }));
    expect(await aiKillSwitchResponse('u1')).toBeNull();
  });

  it('明示的に false にすれば購入者も止まる（案 b/c へ切り替えられる）', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: false },
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

// App Store 審査でデモアカウントが AI を試せないと Guideline 2.1（App Completeness）で
// 弾かれ得るため、審査用アカウントだけ通す口。**緩いと止血に穴が開く**ので厳しめに固定する。
describe('審査用デモアカウントの除外', () => {
  const OFF = { disabled: true, allowPurchasedCredits: false };

  it('uid の完全一致で通る', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect(await aiKillSwitchResponse('demo1')).toBeNull();
  });

  it('前方一致・部分一致では通らない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect((await aiKillSwitchResponse('demo10'))?.status).toBe(503);
    resetAiKillSwitchCache();
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect((await aiKillSwitchResponse('demo'))?.status).toBe(503);
  });

  it('メール指定でも通る（大文字小文字は無視）', async () => {
    mocks.getUser.mockResolvedValue({ email: 'WPUHS2216+demo-pro@Gmail.com' });
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { ...OFF, exemptEmails: ['wpuhs2216+demo-pro@gmail.com'] },
    }));
    expect(await aiKillSwitchResponse('u-demo')).toBeNull();
  });

  it('リストに無いメールは通らない', async () => {
    mocks.getUser.mockResolvedValue({ email: 'someone@example.com' });
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { ...OFF, exemptEmails: ['wpuhs2216+demo-pro@gmail.com'] },
    }));
    expect((await aiKillSwitchResponse('u-other'))?.status).toBe(503);
  });

  it('メール解決に失敗したら通さない（判定できなければ止める）', async () => {
    mocks.getUser.mockRejectedValue(new Error('auth down'));
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { ...OFF, exemptEmails: ['wpuhs2216+demo-pro@gmail.com'] },
    }));
    expect((await aiKillSwitchResponse('u-demo'))?.status).toBe(503);
  });

  it('uid が無ければ通らない', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect((await aiKillSwitchResponse())?.status).toBe(503);
  });

  it('壊れたリスト（文字列・数値混在・空文字）は除外を成立させない', async () => {
    for (const bad of ['demo1', 123, [''], [null], [{ uid: 'demo1' }]]) {
      resetAiKillSwitchCache();
      mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: bad } }));
      expect((await aiKillSwitchResponse('demo1'))?.status).toBe(503);
    }
  });

  it('件数上限を超える分は無視される（実質的な無効化を防ぐ）', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `u${i}`);
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: many } }));
    expect((await getAiKillSwitch()).exemptUids.length).toBeLessThanOrEqual(10);
    expect((await aiKillSwitchResponse('u24'))?.status).toBe(503); // 上限外は通らない
  });

  // 安全網（openrouter.ts の fetch 直前）でも同じ判定が効くこと。
  // ここが効かないと、ルートを通った除外ユーザーが安全網で弾かれて審査が通らない
  // 除外リストが間違っていても「静かに効かない」だけなので、
  // デプロイ後にログで確認できることを担保する（実際に審査用アドレスが違っていた）
  it('除外が効いたときはログに残る（デプロイ後に確認できる）', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
      await aiKillSwitchResponse('demo1');
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain('demo1');
    } finally { spy.mockRestore(); }
  });

  it('除外されなかったときはログを出さない（ノイズにしない）', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
      await aiKillSwitchResponse('someone-else');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('入口を通った除外ユーザーは assertAiEnabled も通る', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect(await aiKillSwitchResponse('demo1')).toBeNull();
    await expect(assertAiEnabled()).resolves.toBeUndefined();
  });

  it('除外されていないユーザーは assertAiEnabled で止まる', async () => {
    mocks.getDb.mockReturnValue(makeDb({ [SWITCH_PATH]: { ...OFF, exemptUids: ['demo1'] } }));
    expect((await aiKillSwitchResponse('other'))?.status).toBe(503);
    await expect(assertAiEnabled()).rejects.toBeInstanceOf(AiDisabledError);
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

// P147: 入口（aiKillSwitchResponse）と安全網（assertAiEnabled）が**同じ結論**を出すこと。
//
// 是正前: 入口は `allowPurchasedCredits` を見て購入者を通すのに、安全網は除外 uid しか見て
// いなかった。＝ 購入クレジット保持者は**入口を通ったあと openrouter 直前で throw** され、
// `AiDisabledError` はどこでも catch されないため **500**（`code: AI_DISABLED` も付かない）に
// なっていた。iOS からは「一時停止」とも「残高不足」とも判別できないただのエラーに見える。
describe('入口と安全網が食い違わない（P147）', () => {
  const SUB = (uid: string) => `account_subscriptions/${uid}`;

  it('購入クレジット保持者: 入口が通したら安全網も通す', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true },
      [SUB('buyer')]: { purchasedCredits: 100 },
    }));
    // 入口が null（＝通す）を返す
    expect(await aiKillSwitchResponse('buyer')).toBeNull();
    // 同じリクエスト文脈で安全網も通ること（是正前はここで throw していた）
    await expect(assertAiEnabled()).resolves.toBeUndefined();
  });

  it('除外 uid: 入口が通したら安全網も通す', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, exemptUids: ['demo'] },
    }));
    expect(await aiKillSwitchResponse('demo')).toBeNull();
    await expect(assertAiEnabled()).resolves.toBeUndefined();
  });

  it('購入残高ゼロ: 入口が 503 なら安全網も止める', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true },
      [SUB('poor')]: { purchasedCredits: 0 },
    }));
    expect((await aiKillSwitchResponse('poor'))?.status).toBe(503);
    await expect(assertAiEnabled()).rejects.toBeInstanceOf(AiDisabledError);
  });

  // 印は「入口を通った」ことの証拠。入口を経ずに安全網へ来たら止まる（fail-closed の維持）
  it('入口を通っていないリクエストは、購入者であっても安全網が止める', async () => {
    mocks.getDb.mockReturnValue(makeDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true },
      [SUB('buyer')]: { purchasedCredits: 100 },
    }));
    enterAiRequest('buyer'); // uid は判るが、入口の判定は通っていない
    await expect(assertAiEnabled()).rejects.toBeInstanceOf(AiDisabledError);
  });

  // 安全網が Firestore を読み直す実装に戻ると、AI 呼び出しのたびに読み取りが増え、
  // かつ入口と別々に判定することで今回の食い違いが再発する
  it('安全網は購入残高を読み直さない（入口の結論を尊重する）', async () => {
    const { db, reads } = makeCountingDb({
      [SWITCH_PATH]: { disabled: true, allowPurchasedCredits: true },
      [SUB('buyer')]: { purchasedCredits: 100 },
    });
    mocks.getDb.mockReturnValue(db);
    expect(await aiKillSwitchResponse('buyer')).toBeNull();
    const afterEntry = reads.subscription;
    await assertAiEnabled();
    expect(reads.subscription).toBe(afterEntry); // 安全網では 1 回も読んでいない
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
