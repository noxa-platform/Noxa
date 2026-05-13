# 配下プロダクト一覧

## YoruLog（CRM 主軸プロダクト）

- **役割**: ナイトワーク事業者向け顧客管理 CRM
- **対象**: ホストクラブ / キャバクラ / スナック / バー の現場スタッフと管理者
- **プラットフォーム**: iOS（SwiftUI ネイティブ）+ Web（Next.js 16）
- **リポジトリ**:
  - Web: https://github.com/wpuhs2216-hub/yorulog
  - iOS: https://github.com/wpuhs2216-hub/yorulog-ios
- **Bundle ID（iOS）**: `ja.com.egshugy.yorulog`
- **Web URL（暫定）**: https://yorulog.vercel.app
- **Firestore コレクション**: `crm_*`
- **課金**: Apple In-App Purchase（消費型クレジット、4 商品）

## nomishugy（バーポータル）

- **役割**: バーの店舗ポータル（旧称 barapp）
- **対象**: ミナミのバー店舗 + 来店ユーザー
- **プラットフォーム**: Web のみ（Next.js 16）
- **リポジトリ**: egshugy-products/nomishugy（プライベート）
- **Web URL（暫定）**: TBA
- **Firestore コレクション**: `barapp_*` / `nomishugy_*`

## egshugy-lab（ミニゲーム / 診断集）

- **役割**: ナイトワーク / SNS バズ系の診断・ミニゲーム
- **プラットフォーム**: Web のみ
- **プロジェクト例**:
  - kuzu-type（タイピングゲーム）
  - ramune-puzzle（パズル）
- **配信**: 社内サーバ（Proxmox CT103 webserver = 192.168.0.77:3001）
- **リポジトリ**: egshugy-products/egshugy-lab + 各サブプロジェクト

## Paperclip（運用基盤）

- **役割**: 全プロダクトの統制・QA・アトリビューション・エージェント定義
- **プラットフォーム**: 内部運用ツール（CLI / スクリプト集）
- **リポジトリ**: egshugy-ops（プライベート）
