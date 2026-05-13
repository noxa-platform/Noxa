# Noxa

**夜職 DX プラットフォーム**。田口修平（個人事業主、屋号: egshugy）が運営する、ナイトワーク事業者向けの統合 SaaS ブランド。

## 全体構造

```
egshugy-lab（田口修平の個人公式サイト、親サイト）
│   将来ドメイン: egshugy.com or egshugy.lab
│
├── プロダクトライン
│   │
│   ├── Noxa （夜職 DX プラットフォーム） ← このリポの対象
│   │   │   将来ドメイン: noxa.com
│   │   ├── YoruLog（CRM）     yorulog.com  iOS + Web
│   │   └── nomishugy（バーポータル） nomishugy.com  Web
│   │
│   └── エグタイプ診断 （診断・ミニゲーム集）
│       ├── kuzu-type（タイピング診断）
│       └── ramune-puzzle 他
│
└── プロフィール / お問合せ / ブログ 等
```

## このリポは何か

**Noxa 事業の親リポ**。YoruLog / nomishugy 等の夜職 DX プロダクトを束ねる運用ナレッジ集約。

田口修平の全体運営（egshugy-lab 親サイト / エグタイプ診断ライン）は別途運営されるため、このリポでは扱わない。

## Noxa 配下プロダクト

| プロダクト | 種別 | リポジトリ | 役割 |
|---|---|---|---|
| **YoruLog** | iOS + Web | [yorulog](https://github.com/wpuhs2216-hub/yorulog) / [yorulog-ios](https://github.com/wpuhs2216-hub/yorulog-ios) | ナイトワーク事業者向け顧客管理 CRM |
| **nomishugy** | Web | (egshugy-products/nomishugy) | バーポータル（Next.js 16） |

## 別ライン（同じ運営者の他事業、ここでは扱わない）

| プロダクトライン | 種別 | 役割 |
|---|---|---|
| **egshugy-lab** | 個人公式サイト | 田口修平の親サイト。プロダクト一覧、プロフィール、ブログ 等 |
| **エグタイプ診断** | Web ミニゲーム集 | kuzu-type / ramune-puzzle 等の診断・ゲーム |
| **Paperclip** | 内部運用基盤 | 統制・QA・アトリビューション・エージェント定義 |

## 共通基盤

| 項目 | 値 |
|---|---|
| **Firebase プロジェクト** | `minami-bar-guide` |
| **OAuth 同意画面アプリ名** | Noxa |
| **Firebase プロジェクト表示名** | Noxa |
| **Bundle ID 接頭辞** | `ja.com.egshugy.*` |
| **運営者** | 田口修平（個人事業主、屋号 egshugy。法人化は将来検討） |
| **ドメイン（取得予定）** | `yorulog.com` `noxa.com` `egshugy.com` `nomishugy.com` |
| **共有 Firestore** | `crm_*` （YoruLog）/ `nomishugy_*` （バーポータル） |

## 重要な区別

### Noxa = 事業ブランド
- 夜職 DX 向けの SaaS プラットフォーム
- ユーザーが「Noxa アカウント」を作成して各プロダクトにログイン
- Google ログイン同意画面では「Noxa が Google アカウントへのアクセスを求めています」と表示

### egshugy / 田口修平 = 運営者・親サイト
- 個人事業主としての運営主体（将来法人化予定）
- 法務情報（特商法 / プライバシーポリシー）の主体
- egshugy-lab は田口修平の個人公式サイト = プロダクト一覧の入口

### エグタイプ診断 = 別のプロダクトライン
- 診断・ミニゲーム系（Noxa とは別軸）
- 同じ運営者だが、Noxa とはターゲット層・収益モデルが異なる

### ユーザー視点では
- アプリ内では「Noxa アカウントを作成」「Noxa にログイン」と表示
- 法務情報には「運営: 田口修平」と記載
- 他のプロダクトに興味があれば egshugy-lab（田口修平の公式サイト）に誘導

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
