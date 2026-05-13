# Noxa

**夜職 DX プラットフォーム**。株式会社 EGS が運営する、ナイトワーク事業者向けの統合 SaaS ブランド。

## 法人構造

```
株式会社 EGS（運営法人）
├── egshugy-lab （会社公式サイト + 診断・ミニゲーム集）
│      ← コーポレート / 入口 / 採用 / 親サイト的位置づけ
│
└── Noxa （夜職 DX プラットフォーム事業）
    ├── YoruLog（CRM）        iOS + Web
    ├── nomishugy（バーポータル） Web
    └── 今後の夜職 DX プロダクト
```

## このリポは何か

**Noxa 事業の親リポ**。YoruLog / nomishugy 等の夜職 DX プロダクトを束ねる運用ナレッジ集約。

会社全体（株式会社 EGS）のコーポレートサイトは別途 egshugy-lab で運営される。

## Noxa 配下プロダクト

| プロダクト | 種別 | リポジトリ | 役割 |
|---|---|---|---|
| **YoruLog** | iOS + Web | [yorulog](https://github.com/wpuhs2216-hub/yorulog) / [yorulog-ios](https://github.com/wpuhs2216-hub/yorulog-ios) | ナイトワーク事業者向け顧客管理 CRM |
| **nomishugy** | Web | (egshugy-products/nomishugy) | バーポータル（Next.js 16） |

## 別軸（株式会社 EGS の他事業）

| プロダクト | 種別 | 役割 |
|---|---|---|
| **egshugy-lab** | Web ミニゲーム集 + 会社サイト | 診断 / ゲーム（kuzu-type / ramune-puzzle 等）+ 法人のコーポレートサイト |
| **Paperclip** | 内部運用基盤 | 統制・QA・アトリビューション・エージェント定義 |

## 共通基盤

| 項目 | 値 |
|---|---|
| **Firebase プロジェクト** | `minami-bar-guide` |
| **OAuth 同意画面アプリ名** | Noxa |
| **Firebase プロジェクト表示名** | Noxa |
| **Bundle ID 接頭辞** | `ja.com.egshugy.*` |
| **ドメイン（取得予定）** | `yorulog.com`（YoruLog Web）、`noxa.com`（Noxa 事業）、`egshugy.com`（株式会社 EGS） |
| **共有 Firestore** | `crm_*` （YoruLog）/ `nomishugy_*` （バーポータル） |

## 重要な区別

### Noxa = 事業ブランド
- 夜職 DX 向けの SaaS プラットフォーム
- ユーザーが「Noxa アカウント」を作成して各プロダクトにログイン
- Google ログイン同意画面では「Noxa が Google アカウントへのアクセスを求めています」と表示

### egshugy / 株式会社 EGS = 法人
- 運営会社
- 法的事業者として「特定商取引法に基づく表記」「プライバシーポリシー」の主体
- コーポレートサイトは egshugy-lab で運営（夜職 DX 以外の事業も配下）

### ユーザー視点では
- アプリ内では「Noxa アカウントを作成」「Noxa にログイン」と表示
- 法務情報には「運営: 株式会社 EGS」と記載
- 会社の他事業に興味があれば egshugy-lab に誘導

## このリポの目的

- **Noxa 事業の運用ガイドライン**集約
- **ブランドアセット**（ロゴ、カラー、フォント）の一元管理
- **商標 / ドメイン**の管理台帳
- **法務情報**（プライバシーポリシー、利用規約のテンプレート）
- 各プロダクトの個別実装は含めない（Windows でも参照しやすいよう純粋なテキスト + アセットのみ）

## ディレクトリ構造

```
Noxa/
├── README.md           ← このファイル
├── CLAUDE.md           ← Noxa 配下プロダクト共通の AI 開発ガイドライン
├── branding/           ← ロゴ・カラー・フォント仕様
├── apps/               ← 各プロダクトの概要 + リンク
└── docs/               ← 商標・ドメイン・法務情報
```

## 環境

- macOS（iOS 開発） + Windows（Web / 設定共有）両対応
- すべてテキスト + 画像アセットのみで、ビルド工程なし → **Windows でも触れる**
