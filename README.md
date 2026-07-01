# NOXA

夜の街のための統合プラットフォーム NOXA のハブ／アカウント／ブランド LP。

## URL 体系

```
noxa-delta.vercel.app/                  ← NOXA ブランド LP
noxa-delta.vercel.app/account/login     ← NOXA アカウントログイン
noxa-delta.vercel.app/account/signup    ← NOXA アカウント作成
noxa-delta.vercel.app/account           ← マイページ（ハブ）
noxa-delta.vercel.app/account/profile   ← プロフィール編集
noxa-delta.vercel.app/account/notifications ← 通知設定
noxa-delta.vercel.app/account/subscription  ← プラン・課金
noxa-delta.vercel.app/account/credits   ← AI クレジット履歴
noxa-delta.vercel.app/account/delete    ← 退会
```

## 関連プロダクト

- **yorulog** (https://yorulog.vercel.app) — 夜職向け売上・顧客管理 CRM
- **nomishugy** (https://nomishugy.vercel.app) — ミナミのバーポータル + 飲み仲間 + バー求人
- **NOXA Community** (近日公開) — 夜の街で働く / 遊ぶ人の交流掲示板

## クロスドメイン認証 (interim)

本ドメイン取得 (noxa.app) 前の暫定構成:

1. yorulog/nomishugy で「ログイン」→ `noxa-delta.vercel.app/account/login?redirect=...` に遷移
2. ログイン成功 → Cloud Function `exchangeAuthToken` で Custom Token 発行
3. `redirect` URL に `?noxaAuth=<token>` を付けて戻す
4. yorulog/nomishugy 側の `NoxaAuthReceiver` が `signInWithCustomToken` で session 確立

本ドメイン取得後はサブドメイン構成 (`auth.noxa.app` + `yorulog.noxa.app`) に切り替えて Cookie 共有 SSO 化予定。

## Firebase

`minami-bar-guide` プロジェクトを yorulog / nomishugy と共有。
- account_users / account_subscriptions / account_iap_transactions 等の共通 doc を直接読み書き
- Cloud Functions は yorulog/functions に集約（`exchangeAuthToken` / `deleteNoxaAccount` 等）

## 開発

```bash
npm install
cp .env.example .env.local   # 値を埋める（NEXT_PUBLIC_* 以外は秘密。コミット禁止）
NEXT_PUBLIC_USE_EMULATOR=true npm run dev  # port 3100
```

### 環境変数

必要な環境変数は `.env.example` に用途コメント付きで全 27 件を列挙。`.env.local` にコピーして設定する。

- `NEXT_PUBLIC_*` はクライアントへ露出（秘密を入れない）。それ以外はサーバ専用。
- 秘密系（`FIREBASE_SERVICE_ACCOUNT_KEY` / `*_SECRET` / `*_SERVICE_ACCOUNT_KEY` / `OPENROUTER_API_KEY` 等）はコミットしない。
- `IAP_ALLOW_UNVERIFIED` は本番で必ず空/false（未検証 grant 防止）。
- 一覧の同期確認: `grep -rhoE 'process\.env\.[A-Z0-9_]+' src | sed 's/process\.env\.//' | sort -u` と `.env.example` のキー集合が一致すること。

### Lint / テスト

```bash
npm run lint          # ESLint 9 flat config（eslint.config.mjs）。src を検査
npm run test          # vitest（純関数の単体テスト）
npm run test:rules    # Firestore ルールテスト（要 Java エミュレータ。WSL 未導入時は CI で実行）
npm run build         # 本番ビルド（WSL で lightningcss 欠落時は補完が必要）
```

## デプロイ

Vercel で `noxa-delta.vercel.app` にデプロイ予定。
