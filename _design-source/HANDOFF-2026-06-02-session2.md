# セッション引き継ぎ — 2026-06-02 (session2 / Noxa OS 実装フェーズ)

> 前セッションが応答バグ（"court" 誤出力）で中断。新セッションはまず本ファイルを読む。
> **本番は全て正常稼働中・デプロイ済み**。未完は「POS プロトの本実装」のみ（着手直前で中断）。

---

## 0. 一行サマリ
Noxa OS（= noxa リポ / **noxa.egshugy.com**）を「夜の街の統合 OS」として構築完了。9+α モジュール・ロールベース表示（個人/店舗）・店舗デバイス認証まで実装＆デプロイ済み。残りは **POS / 席回し / 初回 のプロト本実装（ガワ→本物）** のみ。

## 1. リポジトリ構成（最重要）
| 役割 | GitHub | ブランチ | デプロイ | 本番 URL |
|---|---|---|---|---|
| **Noxa OS（統合 Web・本番の顔）** | noxa-platform/**Noxa** | main | Vercel "noxa"（push で自動 or `vercel --prod --yes`）| **noxa.egshugy.com** / noxa-delta.vercel.app |
| **YoruLog（CRM源・API・Cloud Functions置場）** | noxa-platform/**yorulog** | master | Vercel "yorulog"（手動）＋ **Firebase Functions** | yorulog.vercel.app（Web は非公開扱いで良い・APIのみ要）|
| YoruLog iOS（ネイティブ・売上AI特化）| noxa-platform/**yorulog-ios** | — | App Store（触らない）| — |
| nomishugy（バーポータル）| noxa-platform/**nomishugy** | master | Vercel＋Firebase | nomishugy.vercel.app |
| **Cloud Functions ソース** | = **yorulog/functions/src** | — | Firebase noxa-platform | exchangeAuthToken / storeDeviceLogin 等 |
| POSプロト | wpuhs2216-hub/**host-club-calculator**（Vite+React19+TW4）| master | — | ローカル `C:\Users\wpuhs\host-club-calculator`（GitHub と同期済 v2.3.0）|
| 初回プロト | wpuhs2216-hub/**host-menu-app**（Vite+Capacitor+Supabase）| main | — | `C:\Users\wpuhs\host-menu-app` |
| 席回しプロト | **night_manager**（GitHubなし・ローカルのみ・Next.js・**バグまみれ**）| — | — | `C:\Users\wpuhs\.gemini\antigravity\scratch\night_manager` |

- Firebase プロジェクト: **noxa-platform**（共有 Firestore: personal_*=個人 / shop_shops=店舗 / account_*=共通）。1 UID = 全サービス。
- ドメイン `noxa.egshugy.com` は Cloudflare DNS（CNAME→cname.vercel-dns.com, DNS only）＋ Vercel noxa プロジェクト。Firebase Auth 承認済みドメインに noxa.egshugy.com / yorulog.vercel.app 追加済み。
- **この PC は Tailscale split-DNS で noxa.egshugy.com を解決できない時がある** → 検証は `--resolve noxa.egshugy.com:443:76.76.21.123` の curl か `noxa-delta.vercel.app` で。

## 2. Noxa OS の設計（確定）
- **個人ログイン**（メール/Google/Apple）→ 役割で表示が変わる：個人＝個人機能のみ／オーナー＝全店舗UI／スタッフ＝許可制
- **店舗デバイスログイン**（端末プロファイル＋PIN・共有タブレット用）→ 許可モジュールのみ（**給与/売掛/リスク客は端末で非表示**）
- **個人機能**：売上管理(実データ②)・顧客台帳(実データ)・名刺発注・スケジュール・目標・community・通知センター
- **店舗運営**（店舗登録時のみ）：POS・席回し・勤怠・給与・初回案内・送迎・在庫・体験入店・予約VIP・売掛・リスク客共有
- **YoruLog** = 売上管理 AI 特化ネイティブアプリ（Web の俯瞰は Noxa OS 売上管理②）
- 構成図: `C:\Users\wpuhs\Downloads\noxa-architecture-v2.svg`（+ .png 高解像度）= 最新の正しい全体像

## 3. 実装済み（本番デプロイ済み）
- noxa リポに **9 業務モジュール + α** をガワ実装（components/modules/<name>/<Name>Client.tsx + app/<route>/page.tsx）。各ページは `<AuthGuard>{(user)=><AccountShell user={user}><XClient/></AccountShell>}</AuthGuard>`
- **売上管理② / 顧客台帳 = 実データ**（Firestore: personal_customers/{uid}/items + 自分の shop_shops/{id}/customers の Customer.totalSales 集計）
- **ロールベース表示**: `src/lib/useShopContext.ts`（hasShop= shop_shops owner 判定）。AccountShell + /account ダッシュボードで個人/店舗を出し分け
- **店舗登録**: `/store/new` が実 Firestore 書込（shop_shops 作成＋owner member＋device_profiles[フロア/初回パネル/レジ]に PIN ハッシュ）。ルール確認済（create: ownerUid==uid 許可）
- **店舗デバイス認証**: Cloud Function `storeDeviceLogin`（yorulog/functions/src/noxa-auth.ts, `firebase deploy --only functions:storeDeviceLogin --project noxa-platform` でデプロイ済・既存関数無傷）。`/store-login` が PIN→Custom Token(claims: device/shopId/allow)→signInWithCustomToken。AccountShell が device claims 検出→`useDeviceClaims`で許可モジュールのみ表示
- PIN ハッシュ = SHA-256(`${shopId}:${pin}`)（クライアント Web Crypto と Function の node:crypto で一致）

## 4. 未完（次セッションの作業）= プロト本実装
ガワ → 本物への移植。**着手直前で中断**。
1. **POS**（最優先・着手予定だった）: `host-club-calculator` の伝票計算エンジン（`src/hooks/useCalculator.ts` 513行 + `types/storeConfig.ts` + `data/{defaultStoreConfig,menu}.ts`）を `noxa/src/lib/pos/` に移植し、`components/modules/pos/PosClient.tsx` を実エンジン駆動に作り替え（NOXA デザイン：パネル div・breadcrumb・CSS変数）。React/TW なので移植容易。
2. **席回し**: night_manager（Next.js・**バグまみれ**）を参考に NOXA 席回しモジュールへ移植＋バグ修正。
3. **初回**: host-menu-app（Vite+Supabase）→ Firebase/NOXA へ移植（データ層の置換が要る）。

## 5. モジュールのガワ規範
`noxa/src/components/modules/sales/SalesClient.tsx`（実データ）と各 *Client.tsx を参照。ルート要素は `<div style={{ color:'var(--noxa-text-primary)', fontFamily:'var(--noxa-font-sans-jp)', borderRadius:16, border:'1px solid var(--noxa-border)', padding:'clamp(16px,3vw,28px)', position:'relative', overflow:'hidden' }}>`。`.noxa-zone` は noxa に無い。`.noxa-btn/.noxa-h1/.noxa-h2/.noxa-eyebrow/.noxa-display/.noxa-logo/.noxa-mono/.noxa-hairline` は noxa globals.css にあり。

## 6. CLI 認証（そのまま使える）
- gcloud（wpuhs2216@gmail.com, project noxa-platform）/ firebase CLI / vercel CLI（wpuhs2216-hub）すべてログイン済
- Vercel token: `C:\Users\wpuhs\AppData\Roaming\com.vercel.cli\Data\auth.json`（ドメイン付替に使用した API 操作用）
- ドメイン付替: yorulog↔noxa プロジェクト間は Vercel REST API（DELETE/POST projects/{id}/domains）で実施した実績あり

## 7. 厳守
- iOS リポ yorulog-ios は触らない。globals.css/層 token は変えない。Firestore ルール破壊しない。
- yorulog.vercel.app は API/IAP webhook(/api/iap/notifications-v2)のため deployment は生かす（Web UI は公開不要）。
- functions は `--only functions:<name>` で名指しデプロイ（全 functions デプロイすると他を消す恐れ）。
- 公開前（実ユーザー無し）なので破壊的変更の許容度は高いが、exchangeAuthToken(SSO) は壊さない。
