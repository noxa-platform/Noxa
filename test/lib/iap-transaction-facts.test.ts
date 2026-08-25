import { describe, it, expect } from 'vitest';
import {
  readAppleEnvironment, normalizeClaimedEnvironment, environmentDisagrees,
  readJwsString, readPlayPurchaseKind,
} from '@/lib/iap/transaction-facts';

// 課金トランザクションの素性を**プラットフォーム由来の値**から読む（P146）。
//
// 経緯: `account_iap_transactions.environment` は Apple の JWS ではなく
// **iOS が body で送ってきた値**を保存していた。そのせいで本番データ 4 件を
// 「実在する有料顧客」と読み違えかけた（全部 Sandbox だった）。
// ここのテストは「欠落を肯定の根拠にしない」ことを固定する。

describe('readAppleEnvironment — Apple 由来の環境を読む', () => {
  it('Apple の表記（先頭大文字）を正規化する', () => {
    expect(readAppleEnvironment({ environment: 'Sandbox' })).toBe('sandbox');
    expect(readAppleEnvironment({ environment: 'Production' })).toBe('production');
  });

  it('小文字・前後の空白でも読める', () => {
    expect(readAppleEnvironment({ environment: ' production ' })).toBe('production');
    expect(readAppleEnvironment({ environment: 'sandbox' })).toBe('sandbox');
  });

  // ここが核心。欠落を production に倒すと、素性の分からない購入が
  // 「本物の購入」として記録に残り、後から見分けがつかなくなる
  it('欠落・未知の値・型違いはすべて unknown（production に倒さない）', () => {
    expect(readAppleEnvironment({})).toBe('unknown');
    expect(readAppleEnvironment({ environment: 'Xcode' })).toBe('unknown');
    expect(readAppleEnvironment({ environment: 1 })).toBe('unknown');
    expect(readAppleEnvironment({ environment: null })).toBe('unknown');
    expect(readAppleEnvironment(null)).toBe('unknown');
    expect(readAppleEnvironment('production')).toBe('unknown');
  });
});

describe('environmentDisagrees — 申告と実体の食い違い', () => {
  it('申告が JWS と違えば true', () => {
    expect(environmentDisagrees('sandbox', 'production')).toBe(true);
    expect(environmentDisagrees('production', 'sandbox')).toBe(true);
  });

  it('一致していれば false（表記ゆれも一致扱い）', () => {
    expect(environmentDisagrees('sandbox', 'Sandbox')).toBe(false);
    expect(environmentDisagrees('production', 'production')).toBe(false);
  });

  // 古いクライアントは environment を送ってこない。これを「食い違い」にすると
  // 正常な購入が毎回 warn を吐き、本当の食い違いが埋もれる
  it('申告が無い・読めないときは食い違いとしない', () => {
    expect(environmentDisagrees('sandbox', undefined)).toBe(false);
    expect(environmentDisagrees('sandbox', null)).toBe(false);
    expect(environmentDisagrees('sandbox', 'Xcode')).toBe(false);
  });

  it('JWS 側が unknown なら比べようがないので false', () => {
    expect(environmentDisagrees('unknown', 'production')).toBe(false);
  });
});

describe('normalizeClaimedEnvironment', () => {
  it('申告値も同じ語彙へ寄せる', () => {
    expect(normalizeClaimedEnvironment('Production')).toBe('production');
    expect(normalizeClaimedEnvironment(undefined)).toBe('unknown');
  });
});

describe('readJwsString — 突き合わせ用の項目を安全に取り出す', () => {
  it('文字列はそのまま', () => {
    expect(readJwsString({ bundleId: 'com.noxa.app' }, 'bundleId')).toBe('com.noxa.app');
  });

  // originalTransactionId は数値で来ることがある（桁が大きく JS の数値では欠ける）
  it('数値は string 化する', () => {
    expect(readJwsString({ originalTransactionId: 2000001172963469 }, 'originalTransactionId'))
      .toBe('2000001172963469');
  });

  it('欠落・空文字・型違いは null', () => {
    expect(readJwsString({}, 'bundleId')).toBeNull();
    expect(readJwsString({ bundleId: '' }, 'bundleId')).toBeNull();
    expect(readJwsString({ bundleId: {} }, 'bundleId')).toBeNull();
    expect(readJwsString(null, 'bundleId')).toBeNull();
  });
});

describe('readPlayPurchaseKind — Play のテスト購入を見分ける', () => {
  // Play は通常購入で purchaseType を返さない。欠落＝実購入というのが仕様
  it('欠落は normal（Play の仕様）', () => {
    expect(readPlayPurchaseKind(undefined)).toBe('normal');
    expect(readPlayPurchaseKind(null)).toBe('normal');
  });

  it('0=test / 1=promo / 2=rewarded', () => {
    expect(readPlayPurchaseKind(0)).toBe('test');
    expect(readPlayPurchaseKind(1)).toBe('promo');
    expect(readPlayPurchaseKind(2)).toBe('rewarded');
  });

  it('未知の番号・型違いは unknown（normal に倒さない）', () => {
    expect(readPlayPurchaseKind(99)).toBe('unknown');
    expect(readPlayPurchaseKind('0')).toBe('unknown');
    expect(readPlayPurchaseKind(NaN)).toBe('unknown');
  });
});
