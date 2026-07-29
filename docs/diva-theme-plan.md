# DIVA テーマ／店舗システム再設計 — 実装メモ

夜職クラブ向けの高級ダーク/ライト UI（ゴールド基調）を Noxa に載せるための計画。
このブランチ `feat/diva-theme` は **main・本番・grind には未反映**（人間がレビュー後に統合）。

## いま入っているもの
- `public/diva-system.html` … 完成モック（そのまま開ける）。
  - 開発サーバ起動中に **`http://localhost:3000/diva-system.html`** で表示。
  - 右上トグルで **ダーク／ライト** 切替。ダーク＝墨黒×シャンパンゴールド、ライト＝アイボリー×深ゴールド。
  - 収録画面: メインダッシュボード(PC)／店舗POS・卓上POS(タブレット)／席回し(タブレット)／QR伝票確認(スマホ)／メイン スマホ表示。

## 固まっている設計判断
1. **テーマ色**: 店ごとにアクセント1色を選べる（`ShopConfig.accentPreset`＝gold / champagne / rose / violet…）。土台のダーク/ライトは共通、金の部分だけ差し替え。gold を旗艦プリセットにする。
2. **ダーク／ライト両対応**: 全色をトークン化（`--bg`/`--surface`/`--gold`/`--text`…）。`prefers-color-scheme`（OS追従）＋ `data-theme` トグルの両対応。`next-themes` は導入済みなので配線するだけ。
3. **画面の役割分割**（ロールで出し分け・別アプリにしない）:
   - **メインシステム**（owner/manager・全機能）… PC/スマホ。売上・レポート・キャスト・給与・設定。
   - **営業モード**（cast/accounting/device・canManage=false）… タブレット。席回し・注文・伝票・会計処理のみ。総売上/給与/設定は出さない（UIだけでなくサーバ側 rules/`resolveAccessContext` でも遮断）。
4. **面ごと店舗が導入可否を選べる**: 既存 `ShopConfig.modules`（`{key, enabled}`＋CORE固定）にキー追加。`pos_manage`(CORE)／`pos_tablet`(opt-in)／`pos_qr`(opt-in＋`qrMode: order|bill`)。
5. **営業モードのアプリ化**: **PWA先行**（ストア審査を回避）。完全オフライン会計が要件化したら Capacitor。
6. **認証**: 営業モードパスワード＝**デバイス登録**（メインモードから発行/失効・レート制限・サーバ側スコープ強制）。既存 `store-login`＋`storeDeviceLogin` を流用。売上帰属は既存の担当キャスト帰属（`resolveSaleAttribution`）で別レイヤー。
7. **レシート**: LAN ネットワークプリンタ（Epson ePOS / Server Direct Print、Star CloudPRNT）。PWA から iOS/Android 両対応。プリンタがサーバをポーリングする方式なら mixed-content も回避。キャッシュドロアはプリンタのドロアキックで。

## 実装フェーズ（提案・上から順に薄く通す）
- **P1 テーマ基盤**: モックのトークンを `globals.css` にゴールド×light/dark プリセットとして追加（既存の紫システムは壊さず追加）＋ `next-themes` を dark/light に配線。
- **P2 1画面移植**: 実データのダッシュボードを新トークンで塗り替え（「本物の Noxa がこの見た目になる」の実証）。
- **P3 ロール分割**: メイン/営業モードのレイアウト出し分け＋サーバ側の読み取り境界を締める（`resolveMemberPermissions` の本配線）。
- **P4 モジュール & QR**: `ShopConfig.modules` にPOS面キー追加＋店舗設定UI＋QR伝票モード。
- **P5 PWA & プリンタ**: 営業モードPWA化＋LANレシート連携。

## 触らないもの
- main / 本番デプロイ / iOS 実ビルド / grind ブランチ。統合は人間がレビュー後に実施。
