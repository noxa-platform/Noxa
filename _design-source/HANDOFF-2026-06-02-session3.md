# セッション引き継ぎ — 2026-06-02 (session3 / POS・席回し 本実装)

> session2 の続き。§4 の **POS 本実装**と**席回し**を完了（コミット済み・**未デプロイ**）。
> 残りは **初回（host-menu-app 移植）** と **本番デプロイ（CSO レビュー後）**。

---

## 0. 一行サマリ
POS（伝票計算エンジン移植・複数卓×複数伝票・Firestore・会計→売上転記）と席回し
（フロア管理・AI配置・Firestore）を本実装。ガワ→本物が完了。すべて `tsc`/`next build`
クリーン。**コミット済み・push/デプロイは保留**（認証境界＋ルール変更を含むため）。

## 1. このセッションでやったこと（コミット済み）

### POS（commit noxa `b13858e`）
- `noxa/src/lib/pos/` 新規: `engine.ts`（host-club-calculator の計算ロジックを React 非依存で移植）/ `types.ts` / `defaultConfig.ts`（GENTLY DIVA 値を既定テンプレに）/ `store.ts`（`usePosStore`）
- `PosClient.tsx` を実エンジン駆動に全面作り替え（卓グリッド×伝票タブ×実メニュー×客層/時間/イベント割引×実時間更新の会計伝票）
- 会計確定で `shop_shops/{shopId}/sales` に転記。`SalesClient.tsx` に POS 実会計（本日/累計・件数）を追加表示
- データモデル: `sessions/{tableId}`（slips 配列をインライン保存・member 書込）/ `pos_config/active`（owner seed）/ `sales`（会計）。**既存ルールで充足・ルール変更不要**

### POS 認証（commit yorulog `3781a48`・**未デプロイ**）
- `functions/src/noxa-auth.ts` の `storeDeviceLogin` に、デバイス UID（`dev_{shopId}_{profileId}`）を `shop_shops/{shopId}/members/{uid}` に **role='accounting'（kind='device'）** で upsert する処理を追加
- これで共有タブレットが sessions（member）・sales/payments/tabs（sales-edit）を書ける。owner/manager 専用（pos_config/menus/tables/給与/締め）は遮断のまま
- **認証境界の変更** → CSO レビュー後に `firebase deploy --only functions:storeDeviceLogin --project noxa-platform`

### 席回し（commit noxa `923f4e5` / rules yorulog `b20232a`・**未デプロイ**）
- night_manager（zustand/localStorage）を移植。**dnd-kit/framer-motion/zustand は入れず**タップ操作＋Firestore で再構築
- `noxa/src/lib/seating/`: `types.ts` / `ai.ts`（sourcing 優先度 S/A/B・初回卓ベストペア・席内ローテ・全卓提案）/ `store.ts`（`useSeatingStore`）
- `SeatingClient.tsx` 全面作り替え: フロアグリッド×卓詳細（タップ配置・本指名★・席内ローテ・延長・会計・退店）×キャスト名簿×待ち組×AI提案バナー。タイマー超過で警告色
- データモデル（新規）: `seating_casts` / `seating_tables` / `seating_queue` / `seating_meta`。キャスト稼働状態は卓配置から**導出**（クロスコレクション不整合回避）。開卓連番はトランザクション採番
- **ルール追加が必要**（yorulog `firestore.rules` 末尾に `seating_*` 4 ブロック追記済み・既存不変更）→ `firebase deploy --only firestore:rules --project noxa-platform`

## 2. 次セッションの作業
1. **デプロイ（CSO レビュー後）**: ①noxa を push（main 自動デプロイ）または `vercel --prod --yes` ②`firebase deploy --only functions:storeDeviceLogin --project noxa-platform` ③`firebase deploy --only firestore:rules --project noxa-platform`
   - 注意: rules は yorulog/firestore.rules が正本（barapp 包含）。`--only firestore:rules` で他に影響なし
2. **初回（host-menu-app 移植）**: `C:\Users\wpuhs\host-menu-app`（Vite+Capacitor+Supabase）→ Firebase/NOXA `first-visit` モジュールへ。データ層の置換が要る
3. 動作確認（owner ログイン → /store/new で seed → /pos /seating）。デバイスは function/rules デプロイ後に /store-login から

## 3. 設計判断（確定）
- POS/席回しとも shopId は **device claims 優先 → オーナーの最初の shop**
- POS sessions は卓=`{tableId}` 固定キー、slips インライン。会計で sales 転記＋伝票除去
- 席回しの卓は `seating_tables`（POS の `tables`/`sessions` とは**別物**。POS=伝票、席回し=配置）。卓名は pos_config.tableNames を seed 時に流用
- デバイス member role = **accounting**（sales 編集可・owner 専用は不可）

## 4. 厳守（変更なし）
- iOS リポ yorulog-ios は触らない。globals.css/層 token は変えない。
- 既存 Firestore ルールブロックは破壊しない（今回は**追加のみ**）。exchangeAuthToken(SSO) は壊さない。
- functions は `--only functions:<name>` で名指しデプロイ。

---

## 5. 追記: Firebase バックエンドを NOXA に正本移設（commit noxa `0054374`）

ユーザー方針「yorulog はもう使わない、AI 含め全部 NOXA に集約」に基づき着手。
**Stage 1（安全・可逆・未デプロイ）を完了**。

### やったこと
- `yorulog/functions/` → `noxa/functions/` に全 Cloud Functions を移設（package 名 `noxa-functions`、`tsc` 確認済み）
- `yorulog/firestore.rules` → `noxa/firestore.rules`（seating_* 追加込み）、`firestore.indexes.json` も移設
- `noxa/firebase.json`（firestore + functions のみ・hosting は Vercel 運用で除外）／`noxa/.firebaserc`（default=noxa-platform）作成
- **yorulog に入れていた私の 2 コミット（noxa-auth device-member / seating rules）は撤回**。yorulog の無関係な既存変更（`functions/src/index.ts` の未コミット修正・新規 scripts）は保持
- 親 `egshugy-products/CLAUDE.md` を「正本は noxa/、yorulog/functions・rules はレガシー（編集しない）」に更新（親は git 管理外＝ローカルのみ）

### 以後の正本運用
- ルール: `noxa/` で `firebase deploy --only firestore:rules --project noxa-platform`
- 関数: `noxa/` で `firebase deploy --only functions:<name> --project noxa-platform`（全一括は他を消すので禁止）

### Stage 2（未着手・要計画・本番リスクあり）= yorulog 完全撤去
1. **Web API ルートの移設**: yorulog の Next.js API（特に IAP webhook `/api/iap/notifications-v2`、AI エンドポイント、Stripe webhook 等）を noxa へ移植。AI 関連 DB は同一 Firestore なので**コードと書込経路の移設**が主
2. **シークレット/環境変数の移行**: Stripe / IAP shared secret / AI provider key / Google OAuth を noxa(Vercel) と functions config へ。値はユーザー提供が必要
3. **webhook 先の再設定**: App Store / Google Play / Stripe の通知 URL を新ホストへ。**切替を誤ると課金処理が止まる** → 二重受信期間を設けて検証
4. **カットオーバー**: noxa から `firebase deploy`（rules/functions）→ 本番検証 → 問題なければ `yorulog/functions`・`yorulog/firestore.rules`・該当 API を撤去
5. CSO レビュー必須（認証境界・課金・シークレット）

### Stage 2 着手前の注意
- yorulog の deploy（`vercel --prod`）はカットオーバーまで現状維持（IAP webhook が生きているため）
- `noxa/functions/src/index.ts` は yorulog の未コミット作業を取り込んだ最新版。差分が意図通りか移設前に確認推奨

---

## 6. 追記2: yorulog バックエンドを NOXA へ全移植（コード完了・未デプロイ）

ユーザー方針「yorulog Web は統合用プロトタイプとして残す／他機能は全部 NOXA に写す／
AI は OpenRouter 専用（Gemini 廃止＝キー削除済み）」。**コード移植は完了**。

### 完了コミット（noxa）
- `3d76043` AI 全ルート（`/api/ai/*` 24本）+ provider/lib。**OpenRouter 専用**（gemini.ts 削除・ai-provider 書換）。dep: firebase-admin
- `09a734d` 非AI 全ルート（account/admin/auth(line)/barapp/calendar/feedback/iap/missions/referral）+ lib(missions, iap/products)。dep: googleapis
- `2b4111f` iOS 向け AI 向き先変更プロンプト（`IOS-AI-REPOINT-PROMPT.md`）

→ `noxa/src/app/api/**` に **yorulog Web の全 API ルートが揃った**。tsc・next build クリーン。

### 稼働に必要な env（noxa Vercel に設定。値はユーザーのみ保有）
- AI: `OPENROUTER_API_KEY` / `OPENROUTER_HTTP_REFERER` / `OPENROUTER_X_TITLE` / `AI_PRIMARY_MODEL_FAST`(openrouter:*) / `AI_PRIMARY_MODEL_THINK`(openrouter:*)
- Firebase Admin: `FIREBASE_SERVICE_ACCOUNT_KEY`
- IAP: `APPLE_IAP_BUNDLE_ID` / `GOOGLE_PLAY_PACKAGE_NAME` / `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY`
- LINE: `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET`
- Google OAuth(Calendar): `GOOGLE_CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- ※ Stripe は不在（IAP は Apple/Google のみ）。functions は process.env 不使用（既定 SA で動作）

### カットオーバー（本番切替・要レビュー／課金注意）
1. noxa Vercel に上記 env を設定
2. noxa をデプロイ（push or `vercel --prod`）＋ `firebase deploy --only firestore:rules,functions:<name> --project noxa-platform`
3. 各コンソールに **noxa ドメインの許可リダイレクト URI** を追加:
   - LINE Login: `https://noxa.egshugy.com/api/auth/line/callback`
   - Google OAuth: `https://noxa.egshugy.com/api/calendar/callback`
   （リダイレクトはコード上 `${origin}` 動的生成なのでホスト追従。コンソール許可登録だけ必要）
4. **IAP 通知 URL の切替**（App Store Connect / Google Play）を `https://noxa.egshugy.com/api/iap/notifications-v2` へ。**切替ミスで課金通知が落ちる** → 一定期間は yorulog 側も生かして二重受信で検証
5. iOS: `IOS-AI-REPOINT-PROMPT.md` に沿って AI を NOXA へ（まず aiBaseURL、将来 webBaseURL 全体）
6. 全確認後に yorulog の重複バックエンド（functions/rules/該当 API）を撤去。**yorulog Web 自体はプロトタイプとして残す**
