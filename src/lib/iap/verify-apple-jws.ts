// Apple StoreKit 2 の signedTransaction / signedPayload (JWS) の署名検証。
//
// 検証内容（オフラインで完結・外部APIコール不要）:
//   1. compact JWS (header.payload.signature) を分解し、header.alg == 'ES256' を確認
//   2. header.x5c の証明書チェーン（leaf → intermediate → root）を X509 として解釈
//   3. leaf 公開鍵で JWS 署名（ES256 = P-256 / SHA-256, ieee-p1363 形式）を検証
//   4. チェーン各段の署名関係（leaf は intermediate に、intermediate は root に署名されている）を検証
//   5. チェーンの終端が Apple Root CA - G3（公式ピン）に一致 or 直接署名されていることを確認
//   6. 全証明書の有効期間を確認
//
// 注意: Xcode ローカル StoreKit Testing の JWS はローカル生成証明書で署名されるため
// この検証は通らない（Sandbox/TestFlight/本番の Apple 署名は通る）。
// dev 環境のフォールバックは呼び出し側（route）で制御する。
import { X509Certificate, verify as cryptoVerify } from 'node:crypto';
import { APPLE_ROOT_CA_G3_PEM } from './apple-root-ca-g3';

export type AppleJwsFailure =
  | 'PARSE'            // JWS の形をしていない
  | 'ALG'              // alg が ES256 でない
  | 'NO_X5C'           // x5c チェーンが無い
  | 'CERT_PARSE'       // x5c の証明書が解釈できない
  | 'CERT_EXPIRED'     // 証明書の有効期間外
  | 'SIGNATURE_INVALID'// JWS 署名が leaf 公開鍵で検証できない
  | 'CHAIN_INVALID'    // チェーンの署名関係が壊れている
  | 'ROOT_UNTRUSTED';  // 終端が Apple Root CA - G3 に紐づかない

export type VerifyAppleJwsResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: AppleJwsFailure };

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** JWS を分解して payload(JSON) を返すだけ（署名は検証しない）。dev フォールバック用に公開 */
export function decodeAppleJwsPayload(jws: string): Record<string, unknown> | null {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(b64urlToBuf(parts[1]).toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Apple JWS を完全検証する（署名・チェーン・ルートピン・有効期間） */
export function verifyAppleJws(jws: string): VerifyAppleJwsResult {
  // 1. 分解
  let headerB64: string, payloadB64: string, sigB64: string;
  let header: { alg?: string; x5c?: string[] };
  try {
    const parts = jws.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'PARSE' };
    [headerB64, payloadB64, sigB64] = parts;
    header = JSON.parse(b64urlToBuf(headerB64).toString('utf-8'));
  } catch {
    return { ok: false, reason: 'PARSE' };
  }

  // 2. alg / x5c
  if (header.alg !== 'ES256') return { ok: false, reason: 'ALG' };
  if (!Array.isArray(header.x5c) || header.x5c.length === 0) return { ok: false, reason: 'NO_X5C' };

  // 3. チェーンを X509 化
  let chain: X509Certificate[];
  let root: X509Certificate;
  try {
    chain = header.x5c.map((der) => new X509Certificate(Buffer.from(der, 'base64')));
    root = new X509Certificate(APPLE_ROOT_CA_G3_PEM);
  } catch {
    return { ok: false, reason: 'CERT_PARSE' };
  }

  // 4. 有効期間
  const now = Date.now();
  for (const cert of chain) {
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
      return { ok: false, reason: 'CERT_EXPIRED' };
    }
  }

  // 5. JWS 署名を leaf 公開鍵で検証（ES256 は raw r||s = ieee-p1363）
  const leaf = chain[0];
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf-8');
  const signature = b64urlToBuf(sigB64);
  let sigOk = false;
  try {
    sigOk = cryptoVerify(
      'sha256',
      signingInput,
      { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'SIGNATURE_INVALID' };

  // 6. チェーンの署名関係: chain[i] は chain[i+1] に署名されている
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) {
      return { ok: false, reason: 'CHAIN_INVALID' };
    }
  }

  // 7. ルートピン: 終端が Apple Root CA - G3 と同一 or G3 に直接署名されている
  const last = chain[chain.length - 1];
  const isPinnedRoot = last.raw.equals(root.raw);
  const signedByPinnedRoot = (() => {
    try {
      return last.verify(root.publicKey);
    } catch {
      return false;
    }
  })();
  if (!isPinnedRoot && !signedByPinnedRoot) return { ok: false, reason: 'ROOT_UNTRUSTED' };

  // 8. payload を返す
  const payload = decodeAppleJwsPayload(jws);
  if (!payload) return { ok: false, reason: 'PARSE' };
  return { ok: true, payload };
}
