import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { User } from 'firebase/auth';
import {
  isAllowedRedirect, needsEmailVerification, linkedProviderIds,
  buildLoginRedirectUrl, planPostLoginNavigation,
} from '../../src/lib/auth';

// クロスドメイン redirect のオープン redirect 防止ガード（Day55）。
// custom auth token を載せて window.location.href で遷移させる境界のため、
// ホスト偽装・スキーム悪用の両方を弾くことを固定する。

describe('isAllowedRedirect', () => {
  it('空・null・undefined は不許可', () => {
    expect(isAllowedRedirect(null)).toBe(false);
    expect(isAllowedRedirect(undefined)).toBe(false);
    expect(isAllowedRedirect('')).toBe(false);
  });

  it('許可ホストの完全一致は許可', () => {
    expect(isAllowedRedirect('https://yorulog.vercel.app/home')).toBe(true);
    expect(isAllowedRedirect('https://nomishugy.vercel.app')).toBe(true);
    expect(isAllowedRedirect('https://noxa-delta.vercel.app/x')).toBe(true);
  });

  it('許可ホストのサブドメインは許可（先頭ドット必須）', () => {
    expect(isAllowedRedirect('https://app.yorulog.vercel.app/x')).toBe(true);
  });

  it('サフィックス偽装（xxx.evil.com）は不許可', () => {
    // 許可ホストを接頭辞に持つだけの別ドメインを弾く（先頭ドット判定）
    expect(isAllowedRedirect('https://yorulog.vercel.app.evil.com/x')).toBe(false);
    expect(isAllowedRedirect('https://notyorulog.vercel.app/x')).toBe(false);
  });

  it('未登録ホストは不許可', () => {
    expect(isAllowedRedirect('https://evil.com')).toBe(false);
  });

  it('userinfo による偽装は実ホストで判定される', () => {
    // @ より前は userinfo。実ホストは evil.com なので不許可
    expect(isAllowedRedirect('https://yorulog.vercel.app@evil.com')).toBe(false);
    // 実ホストが許可なら userinfo に何が入っても許可（遷移先は許可ホスト）
    expect(isAllowedRedirect('https://evil.com@yorulog.vercel.app')).toBe(true);
  });

  it('ホスト名は大文字小文字を区別しない（URL 正規化）', () => {
    expect(isAllowedRedirect('HTTPS://YORULOG.VERCEL.APP/x')).toBe(true);
  });

  it('http は許可（localhost 開発等）', () => {
    expect(isAllowedRedirect('http://yorulog.vercel.app')).toBe(true);
    expect(isAllowedRedirect('http://localhost:3000/home')).toBe(true);
  });

  it('http(s) 以外のスキームは許可ホストでも不許可（Day55 ハードニング）', () => {
    // ホストは許可リストに一致するが、非 http スキームには token 付き遷移を許さない
    expect(isAllowedRedirect('ftp://yorulog.vercel.app')).toBe(false);
    expect(isAllowedRedirect('ws://nomishugy.vercel.app')).toBe(false);
  });

  it('javascript: スキームは不許可（ホスト空で二重に弾かれる）', () => {
    expect(isAllowedRedirect('javascript:alert(1)//yorulog.vercel.app')).toBe(false);
  });

  it('URL としてパースできない文字列は不許可', () => {
    expect(isAllowedRedirect('not a url')).toBe(false);
    expect(isAllowedRedirect('/relative/path')).toBe(false);
  });

  // Day104: 自分自身（同一 origin）への復帰は許可リストに載っていなくても許可する。
  // 許可リストは「custom token を載せて他アプリへ渡してよいか」の一覧であり、
  // 自分のページへ戻るだけの AuthGuard の戻り先まで縛ると、カスタムドメインや
  // Vercel の preview URL で配信した瞬間に全ての深リンクが /account へ落ちる。
  it('同一 origin は許可リスト外ホストでも許可', () => {
    expect(isAllowedRedirect('https://noxa.example.com/store/join?shop=s1', 'https://noxa.example.com')).toBe(true);
    expect(isAllowedRedirect('https://noxa-git-x.vercel.app/pos', 'https://noxa-git-x.vercel.app')).toBe(true);
  });

  it('origin が違えば同一ホスト名でも許可しない（port/scheme 差を含む）', () => {
    expect(isAllowedRedirect('https://evil.example/x', 'https://noxa.example.com')).toBe(false);
    expect(isAllowedRedirect('http://noxa.example.com/x', 'https://noxa.example.com')).toBe(false);
    expect(isAllowedRedirect('https://noxa.example.com:8443/x', 'https://noxa.example.com')).toBe(false);
  });

  it('同一 origin 判定でも非 http スキームは弾く', () => {
    expect(isAllowedRedirect('javascript:alert(1)', 'null')).toBe(false);
  });
});

// Day104 実バグ: AuthGuard が `origin + pathname` だけで戻り先を組んでいたため、
// 招待リンク（/store/join?shop=&code=）を未ログインで開くと、ログイン後に
// クエリの落ちた /store/join へ戻され「招待リンクが正しくありません」で行き止まりになっていた。
describe('buildLoginRedirectUrl', () => {
  const loc = (pathname: string, search = '') => ({ origin: 'https://noxa-delta.vercel.app', pathname, search });

  it('クエリを保持する（招待リンクの shop / code が落ちない）', () => {
    expect(buildLoginRedirectUrl(loc('/store/join', '?shop=s1&code=ABCDE23456')))
      .toBe('https://noxa-delta.vercel.app/store/join?shop=s1&code=ABCDE23456');
  });

  it('クエリが無ければ ? を付けない', () => {
    expect(buildLoginRedirectUrl(loc('/pos'))).toBe('https://noxa-delta.vercel.app/pos');
    expect(buildLoginRedirectUrl({ origin: 'https://x.test', pathname: '/a' })).toBe('https://x.test/a');
  });

  it('コミュニティの ?invite=CODE も保持する', () => {
    expect(buildLoginRedirectUrl(loc('/community', '?invite=Ab-_9')))
      .toBe('https://noxa-delta.vercel.app/community?invite=Ab-_9');
  });

  it('noxaAuth（custom token）は戻り先に持ち回らない', () => {
    expect(buildLoginRedirectUrl(loc('/store/join', '?shop=s1&noxaAuth=secret-token&code=X')))
      .toBe('https://noxa-delta.vercel.app/store/join?shop=s1&code=X');
    expect(buildLoginRedirectUrl(loc('/account', '?noxaAuth=secret-token')))
      .toBe('https://noxa-delta.vercel.app/account');
  });

  it('値のエンコードを保つ（日本語・記号）', () => {
    expect(buildLoginRedirectUrl(loc('/store/join', '?shop=a%20b%26c')))
      .toBe('https://noxa-delta.vercel.app/store/join?shop=a+b%26c');
  });
});

// 再発防止の静的ガード: 戻り先 URL の組み立てを AuthGuard 内でベタ書きに戻すと落ちる。
describe('AuthGuard の戻り先組み立て（静的ガード）', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/AuthGuard.tsx'), 'utf8');

  it('buildLoginRedirectUrl を経由している', () => {
    expect(src).toContain('buildLoginRedirectUrl');
  });

  it('origin + pathname のベタ書き（クエリ落ち）が復活していない', () => {
    expect(src).not.toMatch(/window\.location\.origin\s*\+\s*pathname/);
  });
});

// ログイン後の遷移先の決定（同一 origin は custom token 交換を経由しない）
describe('planPostLoginNavigation', () => {
  const ORIGIN = 'https://noxa-delta.vercel.app';

  it('redirect 無し・許可外は fallback（/account へ）', () => {
    expect(planPostLoginNavigation(null, ORIGIN)).toEqual({ kind: 'fallback' });
    expect(planPostLoginNavigation('', ORIGIN)).toEqual({ kind: 'fallback' });
    expect(planPostLoginNavigation('https://evil.com/x', ORIGIN)).toEqual({ kind: 'fallback' });
  });

  it('同一 origin は相対パス遷移（token 交換に失敗して招待の戻り先を失わない）', () => {
    expect(planPostLoginNavigation(`${ORIGIN}/store/join?shop=s1&code=C`, ORIGIN))
      .toEqual({ kind: 'same-origin', path: '/store/join?shop=s1&code=C' });
    expect(planPostLoginNavigation(`${ORIGIN}/account#tab`, ORIGIN))
      .toEqual({ kind: 'same-origin', path: '/account#tab' });
  });

  it('別アプリ（yorulog 等）は cross-origin として custom token 経路に回す', () => {
    expect(planPostLoginNavigation('https://yorulog.vercel.app/home', ORIGIN))
      .toEqual({ kind: 'cross-origin', url: 'https://yorulog.vercel.app/home' });
  });

  it('origin 不明（SSR）でも許可ホストなら cross-origin 扱い', () => {
    expect(planPostLoginNavigation('https://yorulog.vercel.app/home', null))
      .toEqual({ kind: 'cross-origin', url: 'https://yorulog.vercel.app/home' });
  });
});

// User 風の最小オブジェクトを組む（純判定ロジックのみを検証）
function fakeUser(partial: {
  emailVerified?: boolean;
  email?: string | null;
  providerIds?: string[];
}): User {
  return {
    emailVerified: partial.emailVerified ?? false,
    email: partial.email === undefined ? 'a@example.com' : partial.email,
    providerData: (partial.providerIds ?? []).map((providerId) => ({ providerId })),
  } as unknown as User;
}

describe('needsEmailVerification', () => {
  it('検証済みなら false', () => {
    expect(needsEmailVerification(fakeUser({ emailVerified: true, providerIds: ['password'] }))).toBe(false);
  });
  it('email が無ければ false', () => {
    expect(needsEmailVerification(fakeUser({ email: null, providerIds: ['password'] }))).toBe(false);
  });
  it('未検証 かつ password プロバイダなら true', () => {
    expect(needsEmailVerification(fakeUser({ emailVerified: false, providerIds: ['password'] }))).toBe(true);
  });
  it('未検証でも IdP のみ（google/apple）なら false（IdP 側で検証済み扱い）', () => {
    expect(needsEmailVerification(fakeUser({ emailVerified: false, providerIds: ['google.com'] }))).toBe(false);
    expect(needsEmailVerification(fakeUser({ emailVerified: false, providerIds: ['apple.com'] }))).toBe(false);
  });
  it('password と IdP 混在で未検証なら true（password 分の検証が要る）', () => {
    expect(needsEmailVerification(fakeUser({ emailVerified: false, providerIds: ['google.com', 'password'] }))).toBe(true);
  });
});

describe('linkedProviderIds', () => {
  it('providerData の providerId を列挙する', () => {
    expect(linkedProviderIds(fakeUser({ providerIds: ['google.com', 'password'] }))).toEqual(['google.com', 'password']);
    expect(linkedProviderIds(fakeUser({ providerIds: [] }))).toEqual([]);
  });
});
