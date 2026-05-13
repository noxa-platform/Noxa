# Firebase / Google Cloud 設定

## プロジェクト情報

| 項目 | 値 |
|---|---|
| **Project ID**（不変） | `minami-bar-guide` |
| **Project 表示名** | Noxa |
| **Project 番号** | 779513145806 |
| **OAuth 同意画面アプリ名** | Noxa |
| **OAuth ステータス** | 本番環境（公開済み） |
| **ユーザー種別** | 外部（誰でもログイン可） |
| **サポートメール** | wpuhs2216@gmail.com |
| **デベロッパー連絡先** | wpuhs2216@gmail.com |

## 共有 Firestore コレクション

```
crm_workspaces/{wid}                 # YoruLog 専用
├── members/{uid}
├── templates/{tid}
└── customers/{cid}
    ├── logs/{lid}
    └── gifts/{gid}

crm_profiles/{uid}                   # YoruLog ユーザープロフィール
crm_reminders/{rid}                  # YoruLog リマインダー
crm_invites/{code}                   # YoruLog 招待コード
crm_google_tokens/{uid}              # YoruLog Google OAuth トークン
crm_subscriptions/{uid}              # YoruLog Stripe サブスク（API Route 専用）
crm_ai_usage/{uid}/monthly/{yyyy-MM} # YoruLog AI 利用ログ
crm_push_tokens/{uid}                # YoruLog APNs/FCM トークン

barapp_shops/{sid}                   # nomishugy（旧 barapp）店舗
nomishugy_*                          # nomishugy 系
```

## OAuth Client

複数の Client を作成可能（各 Web/iOS で別々）:
- Web 用 (yorulog.com / nomishugy.com)
- iOS 用 (Bundle ID 別)
- Android 用 (Capacitor)

すべての Client は同じ「Noxa」OAuth 同意画面を共有する。

## Firestore ルール運用

- **両プロダクト（yorulog / nomishugy）の `firestore.rules` を完全同期**
- 編集は片方（推奨: nomishugy）で行い、もう片方に `cp` で同期
- デプロイ: `npx firebase-tools deploy --only firestore:rules --project minami-bar-guide`

## 制約

### OAuth 同意画面は 1 プロジェクト 1 つ
- 全プロダクトで「Noxa」表示で統一されている
- 個別表示にするには Firebase プロジェクトを分離するしかない（移行コスト大）

### Project ID は永続変更不可
- `minami-bar-guide` は変更できない
- Firestore ホスト、Firebase Hosting URL、API キーすべてに含まれる

## アカウント

- **オーナー**: wpuhs2216@gmail.com
- **個人事業主**: 田口修平（株式会社EGS 設立予定）
