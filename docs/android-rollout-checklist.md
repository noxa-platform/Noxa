# Android（Google Play）展開チェックリスト

Day11 時点でサーバ側（検証＋付与＋consume）は完了。残りはアプリ側と Play Console の設定作業。

## サーバ側（完了済み・確認のみ）
- [x] `/api/iap/google-play-grant`: androidpublisher v3 で purchaseToken 実検証（本番は Service Account 必須・検証 skip 不可）
- [x] 冪等付与（`account_iap_transactions/gplay_<token>`）＋ `purchases.products.consume`（acknowledge 兼用・失敗時は復元フローで自己修復）
- [ ] 本番 env 設定: `GOOGLE_PLAY_PACKAGE_NAME` / `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY`（Vercel・人間作業）

## Play Console（人間作業）
- [ ] アプリ作成・パッケージ名確定（`GOOGLE_PLAY_PACKAGE_NAME` と一致させる）
- [ ] IAP 商品登録: `src/lib/iap/products.ts` の android product ID と価格を一致させる
- [ ] Service Account に「財務データの閲覧」＋「注文管理」権限を付与（API 有効化: Google Play Android Developer API）
- [ ] ライセンステスター登録（検証課金用）

## アプリ側（別タスク・要ビルド環境）
- [ ] Capacitor（または TWA）で Android シェル作成・Billing プラグイン導入
- [ ] 購入フロー: BillingClient 購入完了 → `/api/iap/google-play-grant` へ {packageName, productId, purchaseToken} POST
- [ ] 購入復元: 起動時に未処理 purchases を再送（409 ALREADY_PROCESSED + consumed:true で完了扱い）
- [ ] `consumed:false` 応答時のリトライ（次回起動の復元で自動再試行される設計）

## テスト手順
1. 内部テストトラックへ AAB アップロード → ライセンステスターで購入
2. クレジット残高加算・`account_iap_transactions` 記録・重複 grant が 409 になることを確認
3. Play Console の注文で「消費済み」になっていること（未消費だと3日で自動返金される）
