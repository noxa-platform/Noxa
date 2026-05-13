# Noxa

夜職 OS・DX 化の親ブランド。複数の SaaS / アプリを統合運営する。

## 配下プロダクト

| プロダクト | 種別 | リポジトリ | 役割 |
|---|---|---|---|
| **YoruLog** | iOS + Web | [yorulog](https://github.com/wpuhs2216-hub/yorulog) / [yorulog-ios](https://github.com/wpuhs2216-hub/yorulog-ios) | ナイトワーク事業者向け顧客管理 CRM |
| **nomishugy** | Web | (egshugy-products/nomishugy) | バーポータル（Next.js 16） |
| **egshugy-lab** | Web ミニゲーム集 | (egshugy-products/egshugy-lab) | 診断 / ゲーム（kuzu-type / ramune-puzzle 等） |
| **Paperclip** | 運用基盤 | (egshugy-ops) | 統制・QA・アトリビューション |

## 共通基盤

| 項目 | 値 |
|---|---|
| **Firebase プロジェクト** | `minami-bar-guide` |
| **OAuth 同意画面アプリ名** | Noxa |
| **Firebase プロジェクト表示名** | Noxa |
| **Bundle ID 接頭辞** | `ja.com.egshugy.*` |
| **ドメイン（取得予定）** | `yorulog.com`（YoruLog 専用 / Web） |
| **共有 Firestore** | `crm_*` （YoruLog）/ `barapp_*` `nomishugy_*` （バーポータル） |

## このリポの目的

- 複数アプリ・サイト・サービスを統合する親ブランドとしての**運用ガイドライン**集約
- **ブランドアセット**（ロゴ、カラー、フォント）の一元管理
- **商標 / ドメイン**の管理台帳
- **法務情報**（プライバシーポリシー、利用規約のテンプレート）
- iOS / Web 各リポの**個別実装は含めない**（Windows でも参照しやすいよう純粋なテキスト + アセットのみ）

## ディレクトリ構造

```
Noxa/
├── README.md           ← このファイル
├── CLAUDE.md           ← 全アプリ共通の AI 開発ガイドライン
├── branding/           ← ロゴ・カラー・フォント仕様
├── apps/               ← 各プロダクトの概要 + リンク
└── docs/               ← 商標・ドメイン・法務情報
```

## 環境

- macOS（iOS 開発） + Windows（Web / 設定共有）両対応
- すべてテキスト + 画像アセットのみで、ビルド工程なし → **Windows でも触れる**
