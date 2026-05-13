# Noxa 配下プロダクト一覧

Noxa は株式会社 EGS が運営する**夜職 DX プラットフォーム事業**。
このリポでは **Noxa 配下のプロダクト**のみ集約する。
egshugy-lab（会社サイト）や Paperclip（内部運用基盤）は EGS 法人の他事業として別途運営。

---

## Noxa 配下プロダクト（夜職 DX）

### YoruLog（CRM 主軸プロダクト）

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

### nomishugy（バーポータル）

- **役割**: バーの店舗ポータル（旧称 barapp）
- **対象**: ミナミのバー店舗 + 来店ユーザー
- **プラットフォーム**: Web のみ（Next.js 16）
- **リポジトリ**: egshugy-products/nomishugy（プライベート）
- **Web URL（暫定）**: TBA
- **Firestore コレクション**: `nomishugy_*`

---

## 株式会社 EGS の他事業（Noxa 配下ではない）

### egshugy-lab（会社サイト + 診断/ミニゲーム）

- **役割**: 株式会社 EGS の**コーポレートサイト**兼、診断・ミニゲーム配信
- **位置づけ**: 法人の親サイト的役割。Noxa 事業を含む全事業の入口
- **プロジェクト例**:
  - kuzu-type（タイピングゲーム）
  - ramune-puzzle（パズル）
  - 会社概要 / 採用 / プレスリリース 等（追加予定）
- **配信**: 社内サーバ（Proxmox CT103 webserver = 192.168.0.77:3001）
- **リポジトリ**: egshugy-products/egshugy-lab + 各サブプロジェクト
- **将来のドメイン候補**: `egshugy.com` / `egshugy.lab`

### Paperclip（内部運用基盤）

- **役割**: 株式会社 EGS 全プロダクトの統制・QA・アトリビューション・エージェント定義
- **位置づけ**: 内部運用ツール（CLI / スクリプト集、表に出ない）
- **リポジトリ**: egshugy-ops（プライベート）

---

## ユーザー導線（将来）

```
egshugy.com (egshugy-lab、会社サイト)
├── 「Noxa 事業を見る」 → noxa.com
├── 「診断・ゲームで遊ぶ」 → egshugy-lab 配下のミニゲーム
└── 「会社情報・採用」 → コーポレート情報

noxa.com (Noxa 事業)
├── 「YoruLog を始める」 → yorulog.com（CRM）
└── 「nomishugy を見る」 → nomishugy.com（バーポータル）
```
