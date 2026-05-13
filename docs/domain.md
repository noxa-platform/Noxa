# ドメイン管理

## 取得予定

### Noxa 親ドメイン
- 候補: `noxa.com` / `noxa.app` / `noxa.jp`
- 用途: 親ブランド公式サイト（将来）
- 推奨: Cloudflare Registrar（¥1,200/年程度）

### YoruLog 製品ドメイン
- 候補: `yorulog.com` / `yorulog.app` / `yorulog.jp`
- 用途: YoruLog プロダクトの公式 Web サイト + iOS の Universal Link
- **推奨**: `yorulog.com`（¥1,500/年程度、Cloudflare Registrar）

### nomishugy 製品ドメイン
- 候補: `nomishugy.com` / `nomishugy.jp`
- 用途: バーポータル
- 取得タイミング: nomishugy 公開時

## 現状（暫定ドメイン）

| プロダクト | 暫定 URL | 制限 |
|---|---|---|
| YoruLog Web | https://yorulog.vercel.app | Vercel 所有なので Google OAuth 承認ドメインに入れられない |
| YoruLog Firebase | https://minami-bar-guide.firebaseapp.com | Firebase Hosting デフォルト |
| YoruLog Firebase Web App | https://minami-bar-guide.web.app | Firebase Hosting デフォルト |

## OAuth 同意画面の承認済みドメイン

### 現在
- `minami-bar-guide.firebaseapp.com`

### 取得後に追加すべき
- `yorulog.com`（YoruLog 公式ドメイン取得後）
- `noxa.com`（Noxa 親ブランド公式取得後）

## DNS 設定の標準値（Vercel ホスティング前提）

ドメインを Cloudflare で取得後、Vercel に紐付ける場合:

### `yorulog.com` をルートで使う場合
- **Type: A**, **Name: @**, **Value: `76.76.21.21`** (Vercel)
- **Type: CNAME**, **Name: www**, **Value: `cname.vercel-dns.com`**

### サブドメインを使う場合
- **Type: CNAME**, **Name: app**, **Value: `cname.vercel-dns.com`**

## 取得後にやること

ドメイン取得 → DNS 設定 → 以下の同時更新:

1. Vercel Project Settings → Domains にドメイン追加
2. Google Cloud Console OAuth 同意画面 → 承認済みドメインに追加
3. Google Search Console で所有権検証（TXT レコード）
4. App Store Connect の Privacy Policy URL を新ドメインに変更
5. iOS コード内の `yorulog.vercel.app` → 新ドメインに sed 置換
6. Web `.env` の `NEXT_PUBLIC_BASE_URL` を新ドメインに変更
