import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Google Calendar OAuth の CSRF 対策 state 署名（signState / verifyState）を固定する（Day84）。
// 旧実装は state=uid 平文で、攻撃者が任意 uid のトークン doc を上書きできた。
// HMAC 署名付き state（uid＋失効 exp＋nonce）にして偽造不可にしたのが本関数。
// firebase-admin は遅延初期化（import 時は初期化しない）ため、純 crypto 関数として直接検証できる。
// 固定する境界:
//   - signState→verifyState の往復で uid が復元される（正規経路）
//   - 署名 or payload の改竄は拒否（timingSafeEqual + 長さガード）
//   - 秘密鍵不一致は拒否（別デプロイの state を受理しない）
//   - 形式不正（ドット無し/先頭ドット/空 sig/空文字）は拒否
//   - payload の型ガード（uid=string・exp=number・exp>=now）を通らないものは拒否
//   - exp=now+10分（STATE_TTL_MS）で発行される
//
// 注記: stateSecret() は CALENDAR_STATE_SECRET || GOOGLE_CLIENT_SECRET || '' を呼び出し時に読む。
// 実バグは発見されず（全経路 default-deny で健全）、本テストは executable spec（プロダクトコード不変）。

const SECRET = 'grind-day84-calendar-secret';

// verifyState が受理する形式で、任意の payload と秘密鍵から state を鍛造するヘルパー。
// 「署名は正しいが payload の中身が不正」ケースの網羅に使う。
function forge(payloadObj: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function decodePayload(state: string): { uid?: unknown; exp?: unknown; n?: unknown } {
  const payload = state.slice(0, state.lastIndexOf('.'));
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
}

describe('calendar CSRF state（signState / verifyState）', () => {
  let signState: (uid: string) => string;
  let verifyState: (state: string) => string | null;

  beforeEach(async () => {
    process.env.CALENDAR_STATE_SECRET = SECRET;
    // 動的 import で毎回モジュールを取り直す（env を確実に反映）。
    const mod = await import('../../src/app/api/calendar/lib');
    signState = mod.signState;
    verifyState = mod.verifyState;
  });

  it('往復: signState した state を verifyState すると uid が復元される', () => {
    expect(verifyState(signState('user-123'))).toBe('user-123');
  });

  it('nonce により2回の署名は別文字列だが、どちらも検証を通る', () => {
    const a = signState('u1');
    const b = signState('u1');
    expect(a).not.toBe(b); // ランダム nonce で毎回異なる
    expect(verifyState(a)).toBe('u1');
    expect(verifyState(b)).toBe('u1');
  });

  it('exp は now+10分（STATE_TTL_MS）で発行される', () => {
    const before = Date.now();
    const p = decodePayload(signState('u1'));
    const after = Date.now();
    const ttl = 10 * 60 * 1000;
    expect(typeof p.exp).toBe('number');
    expect(p.exp as number).toBeGreaterThanOrEqual(before + ttl);
    expect(p.exp as number).toBeLessThanOrEqual(after + ttl);
    expect(typeof p.n).toBe('string'); // nonce が入る
  });

  it('payload 改竄（1文字書き換え）は署名不一致で null', () => {
    const s = signState('u1');
    const [payload, sig] = s.split('.');
    // payload 末尾の文字を別の base64url 文字に変える
    const flipped = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
    expect(verifyState(`${flipped}.${sig}`)).toBeNull();
  });

  it('署名 改竄は null', () => {
    const s = signState('u1');
    const [payload, sig] = s.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(verifyState(`${payload}.${flipped}`)).toBeNull();
  });

  it('ドット無し（旧平文 uid 形式）は null', () => {
    expect(verifyState('user-plain-uid')).toBeNull();
  });

  it('先頭ドットのみ（payload 空・i<=0）は null', () => {
    expect(verifyState('.abc')).toBeNull();
  });

  it('空文字は null', () => {
    expect(verifyState('')).toBeNull();
  });

  it('空 sig（"payload."）は長さガードで null', () => {
    const s = signState('u1');
    const payload = s.slice(0, s.lastIndexOf('.'));
    expect(verifyState(`${payload}.`)).toBeNull();
  });

  it('秘密鍵不一致（別デプロイの state）は null', () => {
    const foreign = forge({ uid: 'u1', exp: Date.now() + 60_000 }, 'a-different-secret');
    expect(verifyState(foreign)).toBeNull();
  });

  it('署名は正しいが uid 欠落の payload は null', () => {
    expect(verifyState(forge({ exp: Date.now() + 60_000 }, SECRET))).toBeNull();
  });

  it('署名は正しいが uid が非文字列の payload は null', () => {
    expect(verifyState(forge({ uid: 123, exp: Date.now() + 60_000 }, SECRET))).toBeNull();
  });

  it('署名は正しいが exp 欠落/非数値の payload は null', () => {
    expect(verifyState(forge({ uid: 'u1' }, SECRET))).toBeNull();
    expect(verifyState(forge({ uid: 'u1', exp: 'later' }, SECRET))).toBeNull();
  });

  it('署名は正しいが exp が過去（失効）の payload は null', () => {
    expect(verifyState(forge({ uid: 'u1', exp: Date.now() - 1 }, SECRET))).toBeNull();
  });

  it('base64url として壊れた payload（不正 JSON）は catch で null', () => {
    // payload に対する正しい署名を付けても、JSON.parse で落ちれば null
    const payload = Buffer.from('not-json-at-all').toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyState(`${payload}.${sig}`)).toBeNull();
  });
});
