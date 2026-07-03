// Apple JWS 検証の偽造拒否テスト。
// 「正規の Apple 署名がなければ絶対に ok にならない」ことを固定する。
// 正規 JWS の受理テストは Apple 秘密鍵が必要なため不可（Sandbox 実機で確認）。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign, X509Certificate } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAppleJws, decodeAppleJwsPayload } from '../../src/lib/iap/verify-apple-jws';
import { APPLE_ROOT_CA_G3_PEM } from '../../src/lib/iap/apple-root-ca-g3';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('verifyAppleJws（偽造拒否）', () => {
  it('JWS ですらない文字列は PARSE で拒否', () => {
    const r = verifyAppleJws('not-a-jws');
    expect(r).toEqual({ ok: false, reason: 'PARSE' });
  });

  it('alg:none は ALG で拒否', () => {
    const header = b64url(JSON.stringify({ alg: 'none' }));
    const payload = b64url(JSON.stringify({ productId: 'cr_starter_250' }));
    const r = verifyAppleJws(`${header}.${payload}.`);
    expect(r).toEqual({ ok: false, reason: 'ALG' });
  });

  it('x5c 無しの ES256 は NO_X5C で拒否', () => {
    const header = b64url(JSON.stringify({ alg: 'ES256' }));
    const payload = b64url(JSON.stringify({ productId: 'cr_starter_250' }));
    const r = verifyAppleJws(`${header}.${payload}.${b64url(Buffer.alloc(64))}`);
    expect(r).toEqual({ ok: false, reason: 'NO_X5C' });
  });

  it('x5c に Apple Root を置いても自作鍵署名は SIGNATURE_INVALID', () => {
    // leaf に本物の Apple Root CA G3 を置き、署名は自作 EC 鍵で行う
    // → leaf 公開鍵(Apple のもの)では検証できず拒否されるはず
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const rootDerB64 = new X509Certificate(APPLE_ROOT_CA_G3_PEM).raw.toString('base64');
    const header = b64url(JSON.stringify({ alg: 'ES256', x5c: [rootDerB64] }));
    const payload = b64url(JSON.stringify({ productId: 'cr_pro_15000', transactionId: '1' }));
    const sig = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const r = verifyAppleJws(`${header}.${payload}.${b64url(sig)}`);
    expect(r).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it.skipIf(!hasOpenssl())('自作の自己署名チェーン（署名は正しい）でも ROOT_UNTRUSTED で拒否', () => {
    // openssl で自己署名 EC 証明書を作り、その鍵で正しく署名した JWS を作る。
    // 署名検証・チェーン検証は通るが、ルートが Apple ではないため拒否されるはず。
    const dir = mkdtempSync(join(tmpdir(), 'fakejws-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath], { stdio: 'ignore' });
    execFileSync('openssl', ['req', '-new', '-x509', '-key', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=Fake Apple/O=Attacker'], { stdio: 'ignore' });
    const certDerB64 = new X509Certificate(readFileSync(certPath)).raw.toString('base64');
    const keyPem = readFileSync(keyPath, 'utf8');

    const header = b64url(JSON.stringify({ alg: 'ES256', x5c: [certDerB64] }));
    const payload = b64url(JSON.stringify({ productId: 'cr_pro_15000', transactionId: '999', bundleId: 'com.example' }));
    const sig = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), {
      key: keyPem,
      dsaEncoding: 'ieee-p1363',
    });
    const jws = `${header}.${payload}.${b64url(sig)}`;

    // 前提確認: decode 自体はできる（署名検証なしなら読めてしまう＝旧実装の穴）
    expect(decodeAppleJwsPayload(jws)?.productId).toBe('cr_pro_15000');
    // 完全検証では拒否される
    const r = verifyAppleJws(jws);
    expect(r).toEqual({ ok: false, reason: 'ROOT_UNTRUSTED' });
    void writeFileSync; // tmp cleanup は OS 任せ（テスト簡素化）
  });

  it('壊れた x5c は CERT_PARSE で拒否', () => {
    const header = b64url(JSON.stringify({ alg: 'ES256', x5c: ['zzzz'] }));
    const payload = b64url(JSON.stringify({}));
    const r = verifyAppleJws(`${header}.${payload}.${b64url(Buffer.alloc(64))}`);
    expect(r).toEqual({ ok: false, reason: 'CERT_PARSE' });
  });
});

