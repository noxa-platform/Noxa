# Noxa 親リポジトリ Claude ガイドライン

このリポは株式会社 EGS が運営する **夜職 DX プラットフォーム事業「Noxa」** の運用ナレッジを集約する。

## 重要原則

### 1. 役割の分離（3 層構造）

```
株式会社 EGS（法人）
├── egshugy-lab （会社サイト + 診断/ゲーム） ← 別軸、ここでは扱わない
└── Noxa（夜職 DX 事業） ← このリポの対象
    ├── YoruLog（CRM）
    └── nomishugy（バーポータル）
```

- **Noxa 親リポ（このリポ）**: 夜職 DX 事業共通のブランド・ドキュメント
- **YoruLog / nomishugy**: 各プロダクトの実装は別リポ
- **egshugy-lab**: 会社サイト・他事業（このリポ管理外）

### 2. テキストベース原則

- このリポは Windows でも触れることを最優先
- Swift / Kotlin / Objective-C 等の Mac/専用 SDK 必須のコードは置かない
- Markdown / YAML / JSON / SVG / PNG のみ

### 3. ブランド整合性

- OAuth 同意画面 / Firebase 表示名は「Noxa」で統一
- iOS / Web のログイン画面では「Noxa にログイン」「Noxa アカウント」と表示
- ログイン後の画面では各プロダクト名（「YoruLog」「nomishugy」）を表示
- 法務情報（特商法）には「運営: 株式会社 EGS」と記載
- ロゴは `branding/` の最新版を全プロダクトで使用

## Noxa 配下プロダクト要約

### YoruLog（iOS + Web）
- ナイトワーク事業者向け CRM
- iOS: SwiftUI ネイティブ / Web: Next.js 16
- リポ: [wpuhs2216-hub/yorulog](https://github.com/wpuhs2216-hub/yorulog) / [yorulog-ios](https://github.com/wpuhs2216-hub/yorulog-ios)
- Firestore コレクション `crm_*`
- 課金: Apple In-App Purchase（消費型クレジット）

### nomishugy
- バーポータル（旧 barapp）
- Web のみ（Next.js 16）
- Firestore コレクション `nomishugy_*`
- 詳細: egshugy-products リポを参照

## 株式会社 EGS の他事業（参考、このリポでは扱わない）

### egshugy-lab
- 会社コーポレートサイト + 診断・ミニゲーム（kuzu-type、ramune-puzzle 等）
- 将来は `egshugy.com` を取得して全事業の入口に
- 社内サーバ配信（Proxmox CT103 webserver = 192.168.0.77:3001）

### Paperclip
- 内部運用基盤（CLI / スクリプト集）

## OAuth / Firebase 制約

- Firebase プロジェクトは 1 つしか持たず、OAuth 同意画面も 1 つ
- ユーザーが Google ログインすると「**Noxa** が Google アカウントへのアクセスを求めています」と表示される
- これは YoruLog でも nomishugy でも同じ表示（プロジェクト共有のため）
- 完全分離するなら Firebase プロジェクト分割が必要（コスト大）

## ドメイン

- 株式会社 EGS 全社ドメイン: `egshugy.com`（会社サイト用、取得予定）
- Noxa 事業ドメイン: `noxa.com`（事業サイト用、取得予定）
- YoruLog ドメイン: `yorulog.com`（CRM 製品サイト用、取得予定）
- nomishugy ドメイン: `nomishugy.com`（バーポータル、取得予定）
- 開発中の暫定ドメイン: `yorulog.vercel.app`、`minami-bar-guide.firebaseapp.com`

## 商標

- **Noxa**: J-PlatPat 検索で 9/41/42 類 ヒット 0 件（2026-05-13 時点）
- **YoruLog**: 未調査
- **egshugy**: 未調査
- 詳細: `docs/trademark.md`

## 推奨ワークフロー

1. Noxa ブランド変更・商標調査などのメタ的タスク → **このリポで管理**
2. YoruLog / nomishugy の個別アプリのコード変更 → 各プロダクトリポで管理
3. egshugy-lab / Paperclip の作業 → 各リポで管理（このリポ外）
4. 共通ドキュメント（プライバシーテンプレート、ロゴ更新）→ このリポを更新し、各プロダクトに同期
