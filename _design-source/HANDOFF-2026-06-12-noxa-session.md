# NOXA 引き継ぎ資料（2026-06-12 セッション）

新セッション用。NOXA の現状・DB構造・アーキ・今回の作業・残課題を1ファイルに集約。

---

## 0. 基本

- **プロダクト**: NOXA＝夜の街統合OS（Next.js 16 / React 19 / TS / Firebase / Vercel）。本番 `noxa.egshugy.com`。
- **リポジトリ**: `noxa-platform/Noxa`。ローカル `C:\Users\wpuhs\egshugy-products\noxa`。
- **作業ブランチ**: ローカルは `feat/community-board`。**push は `git push origin <SHA>:refs/heads/main`**（明示 refspec で main へ）。**NOXA は main push で Vercel 自動デプロイ**（yorulog/nomishugy は手動 `vercel --prod`）。
- **Firebase**: プロジェクト `noxa-platform`（NOXA / yorulog / nomishugy が**同一 Firestore 共有**、Auth UID 共有＝SSO）。
- **Firestore rules / Functions の正本は `noxa/`**：`noxa/firestore.rules`・`noxa/firestore.indexes.json`・`noxa/functions/`。デプロイは `firebase deploy --only firestore:rules,firestore:indexes --project noxa-platform` / `firebase deploy --only functions:<name> --project noxa-platform`（functions は必ず名指し）。
- **言語**: 応答・コメント・コミットは日本語。変数/関数名は英語。

---

## 1. データベース構造（Firestore: noxa-platform）

### 店舗（運営の中心）
`shop_shops/{shopId}` … 店舗ドキュメント（`name`, `ownerUid`, `storeTypeName`(業態), `customTags/customVisitTypes/customPlaces` 等）
- `/config/settings` … **店舗カスタム設定**（`terminology` 用語辞書 / `roles` 役職＋時給 / `modules` 表示・並び・名称 / `salesAttribution` 売上帰属 / `setTimeLength`・`rotationTimeLength`）
- `/pos_config/active` … POS設定（料金/税/メニュー/卓名 `tableNames`）
- `/seating_tables/{tableId}` … **卓の統合状態**（席回し＋POS）。`status`(EMPTY/ACTIVE/CHECK)、`currentHostIds`(現着)、`mainHostIds`(本指名★)、`requestedHostIds`(指名待ち)、`excludedHostIds`(初回案内で非選択＝回さない)、`assignedHistory`、`castStartTimes`、`customers`、`setTimeLength`/`rotationTimeLength`/`innerRotationEnabled`、`startTime`/`entryTime`、**`slips`(POS伝票 inline)**
- `/seating_casts/{castId}` … キャスト名簿（`name`,`rank`(BOSS/役職/非役職/新人),`hourlyWage`,`uid`(本人),`baseStatus`,`seed`）。**初回案内のパネル本体でもある**
- `/seating_queue/{id}` … 待ち組　`/seating_meta/state` … 当日連番 dailySequence
- `/sales/{saleId}` … 会計済み売上（`source`(pos/manual),`amount`,`customerId`,`customerName`,`castUid`,`castName`,`operatorUid`,`dayKey`(営業日6時締め),`checkoutAt`,`voided`/`voidedAt`/`voidReason`/`correctedAt`）
- `/customers/{id}` … 顧客（`name`,`rank`(SS/S/A/B/C=★5),`totalSales`,`visitCount`,`lastContactAt`,`tags`,`mainCastId`/`mainCastUid`,`birthday`/`mbti`/`interests`/`color`=iOS由来）
- `/shifts/{id}` … 出退勤打刻（`castUid`,`date`,`startAt`,`endAt`）　`/shift_plans` … 出勤予定
- `/payrolls/{uid}/items/{YYYY-MM}` … 給与明細（**書き手未実装＝確定は今後**。閲覧は「今月の見込み」をクライアント集計で表示）
- `/menu_orders`,`/menu_info_cards`,`/menu_images`,`/menu_config/main` … 初回案内
- `/inventory`,`/bottle_keeps`,`/transport`,`/transport_vehicles`,`/trials`,`/reservations`,`/unpaid`,`/risk_customers`,`/first_visits` … 各モジュール（多くは既定OFF＝未使用）
- `/device_profiles/panel` … 店舗端末のデバイスパスワード（PIN）

### アカウント・個人
- `account_users/{uid}` … ユーザー（`handle`,`displayName`,`lineUserId`,`status`）/ `/memberships/{shopId}` … 所属店舗
- `personal_customers/{uid}/items`,`personal_sales/{uid}/items`,`personal_goals/{uid}/items`,`personal_reminders/{uid}/items`,`personal_self_styles/{uid}`,`personal_business_cards/{uid}/items` … 個人ワークスペース
- `profile_pages/{handle}` … 公開プロフィール（/u/[handle]）
- `account_subscriptions`,`account_credit_ledger`,`account_iap_transactions`,`reward_referral_*`,`audit_testimonials`,`notification_push_stats` 等

> v2 prefix（`shop_*`/`account_*`/`personal_*`/`reward_*`）に集約済み。旧 `crm_*`/`bars`/`users` 等は移行済み・原則不使用（一部 referral/push-stats が `crm_*` 参照のまま＝未修正の残課題）。

---

## 2. アーキテクチャの肝（ファイルの仕組み）

- **操作対象店舗の解決＝`src/lib/workspace.ts`**：`getActiveShop()`(localStorage `noxa_active_shop`=personal|shopId|未設定) ／ `pickShopId(ownedIds, memberIds, active)` ／ `useWorkspaces(user)`。**全リゾルバ**（`useShopId`、`lib/pos/store` usePosShop、`lib/seating/store` useShopTarget、`useTheme`、payroll/attendance/goals）がこれに従う＝**複数店舗対応**。`WorkspaceSwitcher`（サイドメニュー上部）で個人/各店舗を切替→リロード。
- **店舗設定レイヤー＝`src/lib/shopConfig.ts`**：`useShopConfig(user)` が `config/settings` を読み、`t(key)`(用語解決：店舗上書き→業種プリセット→既定)、`config.modules`(ナビ出し分け)、`config.roles`(時給)、`config.salesAttribution`(会計帰属) を供給。`CORE_MODULE_KEYS`=既定表示(席回し/POS/勤怠/給与/初回案内)。
- **POS×席回し統合**：両者 `seating_tables` を共有（伝票は卓doc inline）。`PosClient` は `focusTableId`/`embedded` で単一卓モード→**席回しの卓詳細からモーダルで会計**（`SeatingClient` 内）。会計 `checkoutSlip` は **runTransaction**：sales作成＋（`slip.customerId`あれば）顧客 totalSales/visitCount increment＋伝票削除を原子的に。
- **テーマ/UIモード**：`useTheme`(`[data-theme]` concafe=ピンク等・業態連動) ／ `useUiMode`(`[data-ui]` easy(既定)/pro。`globals.css` の `html:not([data-ui="pro"])` で文字/ボタン拡大)。`ProModeSwitcher`。
- **顧客ランク＝`src/lib/customerRank.ts`**：data は `rank`(SS/S/A/B/C)、UI は ★5（`rankToStars`/`starsToRank`）。iOS実データに一致。
- **営業日キー＝`src/lib/datetime.ts`**：`businessDayKey`(6時締め)/`businessMonthKey`。POS書込・売上集計で共用。
- **シェル＝`src/components/AccountShell.tsx`**：左サイドメニュー（アイコン＋目的別グループ、店舗運営はアクティブ店舗時のみ）、モバイル下部ナビ `BottomTabBar`（ホーム/席回し/売上/顧客/マイページ）、`WorkspaceSwitcher`。device 時はキオスク表示。
- **店舗端末（キオスク）**：`useDeviceClaims`＋`device_profiles/panel` PIN ログイン。給与/売掛/個人は非表示。→ **将来 Capacitor で専用アプリ化予定**（提案: `_design-source/PROPOSAL-tablet-kiosk-app.md`、未着手）。

---

## 3. このセッションの作業（main 反映済み・全ビルドgreen）

機能：会計→顧客実績の自動接続 / **複数店舗ワークスペース切替** / 顧客台帳・売上を最小CRUDで再構築（★5・店舗/個人両対応） / **POS×席回し統合**（卓→会計1画面） / 席回しフロアボード（残り時間カウントダウン＋アラート）＋セット長編集 / 初回案内の選択→ローテ反映・非選択除外＋開卓ACTIVE化 / 給与「今月の見込み」（勤怠×時給） / 店舗カスタム設定（用語/役職/モジュール/売上ルール）＋業種テーマ（コンカフェ）＋かんたん/プロUIモード。

UI：左メニュー刷新（アイコン＋目的別・個人/店舗の二重分割解消） / モバイル下部ナビ追加 / 英語eyebrow全日本語化 / ロゴ遷移先を /account（ログアウト誤解の解消）。

堅牢化：onSnapshot 全購読にエラーハンドラ / 全APIルート request.json＋JSON.parse ガード / Google IAP検証skipを明示フラグ化 / デッドコード除去（lib/sales・types/v2・_shared）/ businessDayKey一本化 / 取消・修正の二重実行ロック / firestore.rules first_visits 温存＋indexデプロイ。

レビュー（gstack-review＋敵対的サブエージェント）で P1 を修正：スタッフの所属店舗解決（pos/seating に memberships）、取消二重減算、会計失敗の通知化。

---

## 4. 残課題（未着手・設計判断が要る）

1. **オフライン会計**：`checkoutSlip` は runTransaction＝オンライン必須。回線断で失敗（今は失敗をアラート通知のみ）。→ Capacitorアプリ化＋冪等キー＋ローカルキューが本筋（タブレットアプリ提案参照）。
2. **手入力売上の顧客紐付け**：POS会計は顧客実績へ反映、手入力(SalesClient.addSale)は金額のみ＝非対称。手入力にも顧客選択を足すと一致。
3. **勤怠→給与の確定/永続化**：今は「見込み」表示のみ。オーナー確定UI＋`payrolls` 書込（または Cloud Function 月次集計）。
4. **セキュリティ**：Apple IAP(`api/iap/grant`)の JWS 署名検証（Apple JWKS / jose）未実装。`calendar/callback` の state=uid が CSRF 未対策（開始側に cookie/HMAC state）。
5. **legacy 参照**：`api/referral/*`(`crm_referral_*`)、`api/admin/push-stats`(`crm_push_stats`) が旧コレクション参照（CF書き手の確認が要るため未修正）。
6. **community**：既定 Mock（`NEXT_PUBLIC_COMMUNITY_BACKEND` 未設定）。firestore 切替は env＋インデックス投入判断。
7. **売上/顧客**：yorulog ウェブ版ベースで作り直す構想あり（今回は最小CRUDで先行実装済み）。
8. **用語 t() の全モジュール展開**：主要モジュールは反映済み、細かいラベルは順次。

---

## 5. 検証/運用メモ

- ビルド確認：`npm run build`（型は `npx tsc --noEmit`、`.next/types` のstaleは無視可）。
- 検証店舗（実データあり）：`shop_shops/16OtcQIeDA786qsAO1dP`（ホストクラブ「田口 修平」、キャスト15(seed)/卓9/顧客24/売上）。
- ログインアカウント：`wpuhs2216@gmail.com`。
- Playwright プロファイルロック時は `.playwright-mcp-profile` の chrome のみ kill（通常Chromeは触らない）。
- `git add -A` は .playwright-mcp ログを巻き込むので避ける（gitignore 済み）。

---

## 6. メモリ

`~/.claude/projects/C--Users-wpuhs-egshugy-products-noxa/memory/` に `tablet-kiosk-app-plan`（タブレットアプリ化の将来計画）を保存済み。
