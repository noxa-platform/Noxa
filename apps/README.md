# Noxa 配下プロダクト一覧

Noxa は田口修平（個人事業主、屋号 egshugy）が運営する**夜職 DX プラットフォーム事業**。
このリポでは **Noxa 配下のプロダクト**のみ集約する。
egshugy-lab（個人公式サイト）や エグタイプ診断 / Paperclip は別ラインとして別途運営。

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

## 別ライン（同じ運営者の他事業、Noxa 配下ではない）

### egshugy-lab（田口修平の個人公式サイト・親サイト）

- **役割**: 田口修平（個人事業主、屋号 egshugy）の**個人公式サイト**
- **位置づけ**: 全プロダクトの入口・親サイト。プロダクト一覧、プロフィール、ブログ 等
- **配信**: 社内サーバ（Proxmox CT103 webserver = 192.168.0.77:3001）
- **リポジトリ**: egshugy-products/egshugy-lab
- **将来のドメイン候補**: `egshugy.com` / `egshugy.lab`

### エグタイプ診断（診断・ミニゲーム集）

- **役割**: 診断・ミニゲーム配信（Noxa とは別軸のコンテンツライン）
- **プロジェクト例**:
  - kuzu-type（タイピング診断）
  - ramune-puzzle（パズル）
- **配信**: 社内サーバ（egshugy-lab と同じ）
- **リポジトリ**: egshugy-products/ 配下の各サブプロジェクト

### Paperclip（内部運用基盤）

- **役割**: 全プロダクトの統制・QA・アトリビューション・エージェント定義
- **位置づけ**: 内部運用ツール（CLI / スクリプト集、表に出ない）
- **リポジトリ**: egshugy-ops（プライベート）

---

## ユーザー導線（将来）

```
egshugy.com (egshugy-lab、田口修平の個人公式サイト)
├── プロダクト一覧
│   ├── 「Noxa - 夜職 DX プラットフォーム」 → noxa.com
│   │   ├── YoruLog（CRM）→ yorulog.com
│   │   └── nomishugy（バーポータル）→ nomishugy.com
│   └── 「エグタイプ診断 - 診断・ミニゲーム」 → サブドメイン or 別 URL
├── プロフィール / 経歴
└── ブログ / お問合せ
```
