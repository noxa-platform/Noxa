// 課金トランザクションの「素性」を、**クライアントの申告ではなくプラットフォーム由来の値**から読む。
//
// なぜ要るか（2026-08-25 の実測で発覚）:
// `account_iap_transactions` の `environment` は、Apple の JWS ペイロードではなく
// **iOS が body で送ってきた値**をそのまま保存していた。JWS は既にサーバでデコードして
// productId / transactionId / bundleId の一致確認に使っているのに、`environment` だけ
// クライアント申告を採っていた。
//
// これが何を壊すか:
//   1. Sandbox の購入を `production` と申告されても、保存値は `production` になる。
//   2. **後から「この購入は本物か」を判断する根拠に使えない**。実際、4 件の購入を
//      「実在する有料顧客」と読み違えかけた（全部 Sandbox だった）。
//
// ここは**付与するかどうかの判断には使わない**。Apple/Google の検証結果（署名・purchaseState）が
// 付与の可否を決める側で、この値は**記録のため**にある。Sandbox だからといって付与を拒むと、
// TestFlight とレビュー中の審査員が課金できなくなる（＝リジェクト要因）。

/** Apple の `environment`。読めなければ `unknown`（勝手に production と決めない） */
export type AppleEnvironment = 'production' | 'sandbox' | 'unknown';

/**
 * JWS ペイロードから `environment` を読む。
 * Apple は `"Sandbox"` / `"Production"`（先頭大文字）で返すため正規化する。
 * **欠落・未知の値は `unknown`**。ここを `production` に倒すと、素性の分からない
 * トランザクションが本物の購入として記録に残る（今回踏んだ穴の逆向き）。
 */
export function readAppleEnvironment(payload: unknown): AppleEnvironment {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const raw = (payload as Record<string, unknown>).environment;
  if (typeof raw !== 'string') return 'unknown';
  const v = raw.trim().toLowerCase();
  if (v === 'production') return 'production';
  if (v === 'sandbox') return 'sandbox';
  return 'unknown';
}

/** クライアント申告の `environment` を同じ語彙へ寄せる（比較のためだけに使う） */
export function normalizeClaimedEnvironment(claimed: unknown): AppleEnvironment {
  return readAppleEnvironment({ environment: claimed });
}

/**
 * JWS 由来の値とクライアント申告が食い違っているか。
 * **申告が無い場合は食い違いとしない**（古いクライアントは送ってこない）。
 * 食い違いは付与を止める理由にはしないが、**黙って捨てずにログと記録に残す**
 * ——「申告と実体がずれるクライアントが出回っている」ことに気づける唯一の手掛かりになる。
 */
export function environmentDisagrees(fromJws: AppleEnvironment, claimed: unknown): boolean {
  const c = normalizeClaimedEnvironment(claimed);
  if (c === 'unknown') return false;
  return fromJws !== 'unknown' && c !== fromJws;
}

/** JWS ペイロードから文字列項目を安全に取り出す（数値で来ることもあるため string 化） */
export function readJwsString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>)[key];
  if (typeof raw === 'string') return raw.length > 0 ? raw : null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Google Play の `purchaseType`。**通常購入では項目自体が返らない**のが Play の仕様で、
 * 欠落＝実購入。テスト購入（ライセンステスター）は 0 で返る。
 * ＝ Apple の `environment: Sandbox` に当たるのがこれ。今まで一切記録していなかった。
 */
export type PlayPurchaseKind = 'normal' | 'test' | 'promo' | 'rewarded' | 'unknown';

export function readPlayPurchaseKind(purchaseType: unknown): PlayPurchaseKind {
  if (purchaseType === undefined || purchaseType === null) return 'normal';
  if (typeof purchaseType !== 'number' || !Number.isFinite(purchaseType)) return 'unknown';
  switch (purchaseType) {
    case 0: return 'test';
    case 1: return 'promo';
    case 2: return 'rewarded';
    default: return 'unknown';
  }
}
