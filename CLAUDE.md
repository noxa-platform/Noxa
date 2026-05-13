# Noxa 親リポジトリ Claude ガイドライン

このリポは複数プロダクトを統合する **親ブランド「Noxa」** の運用ナレッジを集約する。

## 重要原則

### 1. 役割の分離
- **Noxa**: 親ブランド・運営会社レベルの情報のみ
- **YoruLog**: ナイトワーク CRM の実装（iOS + Web）
- **nomishugy**: バーポータルの実装
- 個別プロダクトの実装コードは Noxa リポに置かない

### 2. テキストベース原則
- このリポは Windows でも触れることを最優先
- Swift / Kotlin / Objective-C 等の Mac/専用 SDK 必須のコードは置かない
- Markdown / YAML / JSON / SVG / PNG のみ

### 3. ブランド整合性
- OAuth 同意画面 / Firebase 表示名は「Noxa」で統一
- 個別アプリ UI は「YoruLog」「nomishugy」と表示（プロダクト名）
- ロゴは `branding/` の最新版を全プロダクトで使用

## 配下プロダクト要約

### YoruLog（iOS + Web）
- ナイトワーク事業者（ホスト/キャバ/スナック等）向け CRM
- iOS: SwiftUI ネイティブ / Web: Next.js 16
- リポ: [wpuhs2216-hub/yorulog](https://github.com/wpuhs2216-hub/yorulog) / [yorulog-ios](https://github.com/wpuhs2216-hub/yorulog-ios)
- Firebase: 共通 `minami-bar-guide`、Firestore コレクション `crm_*`
- 課金: Apple In-App Purchase（消費型クレジット）

### nomishugy
- バーポータル（旧 barapp）
- Web のみ（Next.js 16）
- Firestore コレクション `barapp_*` / `nomishugy_*`
- 詳細: egshugy-products リポを参照

### egshugy-lab
- 診断 / ミニゲーム集（kuzu-type、ramune-puzzle 等）
- 社内サーバ配信（CT103 webserver = 192.168.0.77:3001）
- 詳細: egshugy-products リポを参照

## OAuth / Firebase 制約

- Firebase プロジェクトは 1 つしか持たず、OAuth 同意画面も 1 つ
- ユーザーが Google ログインすると「Noxa が Google アカウントへのアクセスを求めています」と表示される
- これは YoruLog でも nomishugy でも同じ表示（プロジェクト共有のため）
- 完全分離するなら Firebase プロジェクト分割が必要（コスト大）

## ドメイン

- 親ドメイン: 未取得（候補: `noxa.com` / `noxa.app`）
- YoruLog ドメイン: 未取得（候補: `yorulog.com`）
- 開発中の暫定ドメイン: `yorulog.vercel.app`、`minami-bar-guide.firebaseapp.com`

## 商標

- **Noxa**: J-PlatPat 検索で 9/41/42 類 ヒット 0 件（2026-05-13 時点）
- 詳細: `docs/trademark.md`

## 推奨ワークフロー

1. ブランド変更・商標調査などのメタ的タスク → **このリポで管理**
2. 個別アプリのコード変更 → 各プロダクトリポで管理
3. 共通ドキュメント（プライバシーテンプレート、ロゴ更新）→ このリポを更新し、各プロダクトに同期
