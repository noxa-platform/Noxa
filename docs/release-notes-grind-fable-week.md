# grind/fable-week → main PR 草案（Fable週間グラインド 2026-07-02〜07-03）

> マージ・本番デプロイは人間承認後。この文書は PR 説明文の下書き。
> rules の本番反映（`firebase deploy --only firestore:rules`）と Vercel 反映は main マージ後に人間が実施。

## 一言まとめ
「店舗がチームで導入し、招待→打刻→POS→売上→給与確定まで回り、金銭事故が起きない」＝商品として売れる最低ラインまでの断線修復＋席回し/NOXAページの完成度向上。

## 変更ハイライト（Day別）

### Day1-2: 検証基盤（済報告済み）
- ESLint を Next16 flat config へ修復（クラッシュ解消・実検査化）
- `.env.example`（全27 env・用途コメント）/ README 手順
- vitest 分離（unit / rules）＋ GitHub Actions CI（temurin JRE で rules テスト実行）

### Day3: P0 セキュリティ / 金銭事故の根絶
- **Apple IAP JWS 署名検証を本実装**（x5c チェーン＋Apple Root CA G3 ピン・オフライン完結）。本番は偽造 JWS=403。notifications-v2 も署名検証化。偽造拒否テスト6件
- **Google Play grant 実検証**（androidpublisher v3）。`IAP_ALLOW_UNVERIFIED` は非本番限定に
- **rules 穴3点封鎖**: account_users の PII 公開 read / notification_inbox の他人宛偽通知 / noxa_posts・comments の未招待投稿。ネガティブ rules テスト11件
- insights-narrative の**クレジット消費漏れ**修正（無料叩き放題→withReservedCredits）

### 追加A: 席回しバグ総ざらい（「バグまみれ」報告対応）
- **P0: 席回し操作が POS 伝票(slips)を巻き戻して消す**（古いローカル状態で卓doc全体を上書き）→ 全操作を「txで最新読み→変更フィールドのみ書く」へ全面改修
- P0: 使用中卓への二重開卓で先客データ消失 → ガード＋UI表示
- P1: 2端末同時操作で1キャスト2卓 / 当日連番が日をまたいで無限増加 / 待ち組の二重案内 / **延長がセット長を恒久加算（料金・セット数ずれ）** / 会計が片方向で戻せない / キャスト削除の幽霊配置 → すべて修正（計11バグ・純ロジック分離＋テスト19件）

### Day4: メンバー招待（「チームで使えない」の解消）
- 招待発行/受諾 API＋店舗設定のメンバー管理UI＋`/store/join` 参加ページ
- **rules 穴2点封鎖**: members の自己登録（誰でも任意の店に参加できた）/ invites のコード列挙。rules テスト9件
- 受諾時に席回し名簿と自動紐付け（同名未連携があれば uid をセット）

### Day5: 給与¥0の解消（打刻→給与の一気通貫）
- キャスト編集UI（時給・rank・**アカウント連携select**）＝ seating_casts.uid 断線の解消
- finalize-payroll に時給フォールバック（未連携キャストへ直接入力）・給与確定を manager にも開放
- **退勤忘れ対策**: 前日の未退勤が今日の出勤をブロックし前日 doc に今日の時刻が入るバグを修正。警告カード＋実時刻クローズ。本人による打刻修正/削除UI

### 追加B: NOXAページ（ブロック式ビルダー Lane B/C）
- Block型（text/link/schedule・壊れデータで落ちない normalizeBlocks・javascript: URL 注入防止）
- 公開ページのブロック描画（旧 bio/sns ページは fallback で非破壊）
- エディタ刷新: 公開範囲3値（公開/リンク限定/非公開）・ブロック追加/並べ替え/表示切替・旧データの one-way migration。テスト9件

### Day6: 権限整合とスケール
- POS会計 rules を役割ベース化（一般キャストが他人担当伝票の会計で permission-denied になる現場詰まりの解消）＋テスト4件
- リスク管理/未収の UI ゲートを owner/manager/accounting に（rules と一致）
- 売上の全件購読 → 当月期間クエリ（read 数の破綻防止）
- クレジット履歴が**常に空**になる field 不一致（consumedAt/createdAt）修正
- 退会 Functions URL の旧プロジェクト（minami-bar-guide）残存を修正

### Day7: 検証・可視化
- 主要画面のエラー可視化（sales/attendance/payroll/goals の catch 握りつぶし→バナー/alert）
- 本番ビルドのルートスモーク: 主要9ルート HTTP 200・存在しないプロフィールに `noindex,nofollow` を実証

## ゲート結果
| ゲート | 結果 |
|---|---|
| `npm run test`（unit 38件） | ✅ PASS |
| `npm run test:rules`（rules 33件） | ✅ CI で PASS（ローカルは Java 無し） |
| `npx tsc --noEmit` | ✅ EXIT 0 |
| `npm run build` | ✅ EXIT 0 |
| `npx eslint` | ⚠️ 既存負債 57 error（react-hooks 系・今回の新規コードは 0 error。別タスクで返済） |

## マージ後に人間がやること
1. `firebase deploy --only firestore:rules --project noxa-platform`（rules 変更: account_users/notification_inbox/noxa_posts/comments/members/invites/sales）
2. main へのマージ（Vercel 自動デプロイ）
3. `docs/team-onboarding-e2e.md` の手順で本番 E2E（招待→打刻→POS→給与）
4. iOS 側確認: account_users を他人 read していないか（rules 縮小の影響。Web は全箇所 self 確認済み）
5. App Store Connect: Server Notifications URL 設定（/api/iap/notifications-v2）

## 来週バックログ（抜粋）
POS会計→未収連携 / 顧客全件購読のページング / オーナーによる他人打刻修正UI / lint 負債57件の返済 / seedTestData の隔離 / NOXAページ画像ブロック（Storage 基盤）
