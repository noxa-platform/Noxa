import { describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { isAllowedRedirect, needsEmailVerification, linkedProviderIds } from '../../src/lib/auth';

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
