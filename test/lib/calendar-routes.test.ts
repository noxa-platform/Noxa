import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Google カレンダー連携の 4 route（start / callback / list / events）を消化する（Day111）。
// 未カバー route の中で最大（253行）かつ外部 OAuth＝トークンを扱う面。
//
// 固定する境界:
//   - start: 未認証 401 / client_id 未設定 500 / 署名 state 付きの認可 URL
//   - callback: **平文 uid state を既定で受理しない**（Day111 で既定を反転した CSRF 対策）。
//               リダイレクト先は実在する `/account/connections`（旧 `/calendar*` は 404 だった）
//   - list: 未認証・トークン無しは 401
//   - events: 全カレンダー取得失敗を「予定なし（空配列 200）」にしない。部分失敗はヘッダで伝える
//
// 外部 fetch と Admin SDK はモックする（ネットワーク・認証情報なしで回すため）。

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getDb: vi.fn(), fetch: vi.fn() }));

vi.mock('../../src/app/api/lib/firebase-admin', () => ({
  verifyRequest: mocks.verify,
  getAdminDb: mocks.getDb,
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from '../../src/app/api/lib/firebase-admin';
import { GET as startGET } from '../../src/app/api/calendar/start/route';
import { GET as callbackGET } from '../../src/app/api/calendar/callback/route';
import { GET as listGET } from '../../src/app/api/calendar/list/route';
import { GET as eventsGET } from '../../src/app/api/calendar/events/route';
import { signState } from '../../src/app/api/calendar/lib';

const SECRET = 'grind-day111-calendar-secret';

/** NextRequest の代わり（route が使うのは nextUrl / searchParams / url のみ） */
function req(url: string) {
  const u = new URL(url);
  return { nextUrl: u, url: u.toString() } as never;
}

/** account_google_tokens/{uid} だけを持つ最小フェイク */
function makeDb(tokens: Record<string, Record<string, unknown>> = {}) {
  const saved: Record<string, Record<string, unknown>> = {};
  return {
    saved,
    db: {
      doc: (p: string) => ({
        get: async () => ({ exists: tokens[p] !== undefined, data: () => tokens[p] }),
        set: async (d: Record<string, unknown>) => { saved[p] = { ...(saved[p] ?? {}), ...d }; },
      }),
    },
  };
}

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

beforeEach(() => {
  process.env.CALENDAR_STATE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  delete process.env.CALENDAR_ALLOW_LEGACY_STATE;
  mocks.verify.mockReset().mockResolvedValue('u1');
  mocks.getDb.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('calendar/start（署名 state 付きの認可 URL）', () => {
  it('未認証は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('no'));
    const res = await startGET(req('https://noxa.test/api/calendar/start'));
    expect(res.status).toBe(401);
  });

  it('client_id 未設定は 500（無効な認可 URL を返さない）', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = '';
    const res = await startGET(req('https://noxa.test/api/calendar/start'));
    expect(res.status).toBe(500);
  });

  it('認可 URL に redirect_uri と署名 state（uid 平文ではない）が入る', async () => {
    const res = await startGET(req('https://noxa.test/api/calendar/start'));
    const { url } = await res.json();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('redirect_uri')).toBe('https://noxa.test/api/calendar/callback');
    expect(u.searchParams.get('access_type')).toBe('offline'); // refresh_token を得るため
    const state = u.searchParams.get('state') ?? '';
    expect(state).toContain('.');   // payload.sig 形式
    expect(state).not.toBe('u1');   // 平文 uid ではない
  });
});

describe('calendar/callback（CSRF・到達性）', () => {
  const location = (res: { headers: Headers }) => new URL(res.headers.get('location') ?? '');

  it('code が無ければ実在ページへ戻す（旧 /calendar/connect は存在せず 404 だった）', async () => {
    const res = await callbackGET(req('https://noxa.test/api/calendar/callback'));
    const l = location(res);
    expect(l.pathname).toBe('/account/connections');
    expect(l.searchParams.get('calendar')).toBe('no_code');
  });

  it('★平文 uid の state は既定で受理しない（他人のトークン doc を上書きさせない）', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req('https://noxa.test/api/calendar/callback?code=c&state=victim-uid'));

    expect(location(res).searchParams.get('calendar')).toBe('invalid_state');
    expect(saved).toEqual({}); // トークンは保存されない
  });

  it('CALENDAR_ALLOW_LEGACY_STATE=true を明示したときだけ平文 state を受理する（移行用の逃げ道）', async () => {
    process.env.CALENDAR_ALLOW_LEGACY_STATE = 'true';
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req('https://noxa.test/api/calendar/callback?code=c&state=legacy-uid'));

    expect(location(res).searchParams.get('calendar')).toBe('connected');
    expect(saved['account_google_tokens/legacy-uid']).toMatchObject({ accessToken: 'at', refreshToken: 'rt' });
  });

  it('署名 state は受理し、その uid のトークンとして保存する', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${encodeURIComponent(signState('u1'))}`));

    expect(location(res).searchParams.get('calendar')).toBe('connected');
    expect(saved['account_google_tokens/u1']).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' });
  });

  it('別の秘密鍵で署名された state は拒否（他デプロイの state を使い回せない）', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);
    const payload = Buffer.from(JSON.stringify({ uid: 'attacker', exp: Date.now() + 60000, n: 'x' })).toString('base64url');
    const sig = crypto.createHmac('sha256', 'other-secret').update(payload).digest('base64url');

    const res = await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${payload}.${sig}`));

    expect(location(res).searchParams.get('calendar')).toBe('invalid_state');
    expect(saved).toEqual({});
  });

  it('トークン交換に失敗したら保存せず理由つきで戻す', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, text: async () => 'invalid_grant' });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${encodeURIComponent(signState('u1'))}`));

    expect(location(res).searchParams.get('calendar')).toBe('token_exchange');
    expect(saved).toEqual({});
  });
});

describe('saveTokenDoc（再連携で refresh_token を失わない）', () => {
  it('★refresh_token が返らない再連携では既存の refreshToken を消さない', async () => {
    // Google は再同意なしの再連携で refresh_token を省くことがある。空文字で上書きすると
    // アクセストークン失効の瞬間に連携が無言で死ぬ（画面は「カレンダー0件」になるだけ）
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at3', expires_in: 3600 }) });
    const { db, saved } = makeDb({ 'account_google_tokens/u1': { accessToken: 'old', refreshToken: 'keep-me', expiresAt: FUTURE() } });
    mocks.getDb.mockReturnValue(db);

    await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${encodeURIComponent(signState('u1'))}`));

    expect(saved['account_google_tokens/u1']).toMatchObject({ accessToken: 'at3' });
    expect(saved['account_google_tokens/u1']).not.toHaveProperty('refreshToken'); // merge:true で既存が残る
  });

  it('refresh_token が返ったときは更新する', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at4', refresh_token: 'new-rt', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${encodeURIComponent(signState('u1'))}`));

    expect(saved['account_google_tokens/u1']).toMatchObject({ accessToken: 'at4', refreshToken: 'new-rt' });
  });
});

// 夕方レビューパス（Day111-PM）で見つけた穴。
// 鍵が空文字でも HMAC は計算できるため、鍵未設定のデプロイでは「誰でも正しい署名を作れる」
// ＝ CSRF 対策が無いのに素通りしていた（テストは常に鍵を設定していたので気づけなかった）。
describe('署名鍵が未設定のときは fail-closed（Day111-PM）', () => {
  beforeEach(() => {
    delete process.env.CALENDAR_STATE_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('★鍵が無ければ空鍵で鍛造した署名 state を受理しない', async () => {
    const payload = Buffer.from(JSON.stringify({ uid: 'victim', exp: Date.now() + 60000, n: 'x' })).toString('base64url');
    const forged = crypto.createHmac('sha256', '').update(payload).digest('base64url'); // 誰でも作れる署名
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${payload}.${forged}`));

    expect(new URL(res.headers.get('location') ?? '').searchParams.get('calendar')).toBe('invalid_state');
    expect(saved).toEqual({});
  });

  it('★鍵が無ければ認可 URL も発行しない（500。CSRF 対策の効かない連携を始めさせない）', async () => {
    const res = await startGET(req('https://noxa.test/api/calendar/start'));
    expect(res.status).toBe(500);
  });
});

describe('トークン交換の応答が壊れている場合（Day111-PM）', () => {
  it('200 でも access_token が無ければ保存せず token_exchange として戻す', async () => {
    // 旧: undefined を保存しようとして Admin SDK が例外 → 「不明なエラー」に化けていた
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ error: 'invalid_grant' }) });
    const { db, saved } = makeDb();
    mocks.getDb.mockReturnValue(db);

    const res = await callbackGET(req(`https://noxa.test/api/calendar/callback?code=c&state=${encodeURIComponent(signState('u1'))}`));

    expect(new URL(res.headers.get('location') ?? '').searchParams.get('calendar')).toBe('token_exchange');
    expect(saved).toEqual({});
  });
});

// Day95-PM で潰した「クライアント入力でオブジェクトを索引する」パターンを、Day111 の
// 連携結果バナーで**自分で持ち込んでいた**（`CALENDAR_RESULT[searchParams.get('calendar')]`）。
// `?calendar=constructor` はプロトタイプ由来の関数を拾い、text が undefined の空バナーが出る。
describe('連携結果バナー: クエリでオブジェクトを索引しない（Day111-PM）', () => {
  const src = readFileSync(resolve(__dirname, '../../src/app/account/connections/page.tsx'), 'utf8');

  it('結果表は Map で引く（素のオブジェクト索引に戻さない）', () => {
    expect(src).toContain('CALENDAR_RESULT = new Map');
    expect(src).toContain('CALENDAR_RESULT.get(');
    expect(src).not.toMatch(/CALENDAR_RESULT\[/);
  });

  it('Map なのでプロトタイプ由来のキーは引けない（挙動そのものの確認）', () => {
    const m = new Map(Object.entries({ connected: { kind: 'ok' } }));
    for (const k of ['constructor', 'toString', '__proto__']) expect(m.get(k) ?? null).toBeNull();
  });
});

describe('calendar/list', () => {
  it('未認証は 401', async () => {
    mocks.verify.mockRejectedValue(new AuthError('no'));
    const res = await listGET(req('https://noxa.test/api/calendar/list'));
    expect(res.status).toBe(401);
  });

  it('トークン未連携（doc 無し）は 401＝「カレンダー0件」と区別できる', async () => {
    mocks.getDb.mockReturnValue(makeDb().db);
    const res = await listGET(req('https://noxa.test/api/calendar/list'));
    expect(res.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled(); // 無駄な外部呼び出しをしない
  });

  it('有効トークンがあれば id/summary だけに絞って返す', async () => {
    mocks.getDb.mockReturnValue(makeDb({ 'account_google_tokens/u1': { accessToken: 'at', refreshToken: 'rt', expiresAt: FUTURE() } }).db);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'c1', summary: '仕事', description: '内部メモ' }] }) });

    const res = await listGET(req('https://noxa.test/api/calendar/list'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'c1', summary: '仕事' }]);
  });
});

describe('calendar/events（取得失敗を「予定なし」と混ぜない）', () => {
  const withToken = () => mocks.getDb.mockReturnValue(
    makeDb({ 'account_google_tokens/u1': { accessToken: 'at', refreshToken: 'rt', expiresAt: FUTURE() } }).db,
  );

  it('calendarId 未指定は空配列（呼び出し側の指定漏れ＝失敗ではない）', async () => {
    const res = await eventsGET(req('https://noxa.test/api/calendar/events'));
    expect(await res.json()).toEqual([]);
  });

  it('★全カレンダーの取得に失敗したら 502（空配列 200 で「予定なし」を装わない）', async () => {
    withToken();
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    const res = await eventsGET(req('https://noxa.test/api/calendar/events?calendarId=c1&calendarId=c2'));

    expect(res.status).toBe(502);
    expect(res.headers.get('X-Calendar-Failed')).toBe('c1,c2');
    expect((await res.json()).failedCalendarIds).toEqual(['c1', 'c2']);
  });

  it('★部分失敗は取れた分を返しつつ、欠けた事実をヘッダで伝える', async () => {
    withToken();
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'e1', summary: '出勤', start: { dateTime: '2026-08-14T19:00:00+09:00' }, end: { dateTime: '2026-08-15T01:00:00+09:00' } }] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const res = await eventsGET(req('https://noxa.test/api/calendar/events?calendarId=ok&calendarId=ng'));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Calendar-Failed')).toBe('ng');
    expect(await res.json()).toHaveLength(1);
  });

  it('全件成功なら失敗ヘッダは付かない（常時警告にしない）', async () => {
    withToken();
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });

    const res = await eventsGET(req('https://noxa.test/api/calendar/events?calendarId=c1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Calendar-Failed')).toBeNull();
  });

  it('タイトル無しの予定は「(タイトルなし)」で返し、顧客/WS の紐付けを素通しする', async () => {
    withToken();
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [
      { id: 'e1', start: { date: '2026-08-14' }, end: { date: '2026-08-15' }, extendedProperties: { private: { app_customer_id: 'cus1', app_workspace_id: 'ws1' } } },
    ] }) });

    const res = await eventsGET(req('https://noxa.test/api/calendar/events?calendarId=c1'));

    expect(await res.json()).toEqual([
      { id: 'e1', summary: '(タイトルなし)', start: '2026-08-14', end: '2026-08-15', customerId: 'cus1', workspaceId: 'ws1' },
    ]);
  });
});
