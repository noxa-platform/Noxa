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
- P1: 2端末同時操作で1キャスト2卓 / 当日連番が日をまたいで無限増加 / 待ち組の二重案内 / **延長がセット長を恒久加算（料金・セット数ずれ）** / 会計が片方向で戻せない / キャスト削除の幽霊配置 / 購読エラーの握りつぶし（空表示＝成功と区別不能） / clearSeedData が営業中の卓・POS伝票まで白紙化 → すべて修正（計14バグ・純ロジック分離＋テスト31件、AI提案の lock/excluded 除外もテストで固定）

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
| `npm run test`（unit 50件） | ✅ PASS |
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
POS会計→未収連携 / 顧客全件購読のページング / オーナーによる他人打刻修正UI / lint 負債57件の返済 / seedTestData の隔離 / NOXAページ画像ブロック（Storage 基盤） / 席回しの楽観更新(BUG-14) / ローテ時 castStartTimes の扱い(BUG-12・要仕様判断)

---

## 追記（2026-07-04）: 席回しコマンドセンター M1〜M6（最優先ミッション）

「席回し画面一つで店が回る」——伝票・売上・新規案内を席回しにシームレス統合。

### M4: 会計→担当売上の直接記録
- `resolveSaleAttribution`（純関数）: castUid の無い伝票を castId/castName から名簿解決。**担当売上が会計操作者へ誤帰属するバグを修正**
- sales doc に 指名区分（本指名/場内/フリー）・同伴・castId を保存し、CF が個人控え/担当台帳ログへコピー
- **断線修復**: CF の個人控えに amount/dayKey が無く、POS会計が個人売上画面に一切表示されなかった問題を修正（※既存本番データの控えは dayKey バックフィルが必要＝人間判断）
- 売上一覧に 本指名/場内/同伴 バッジ

### M1: 卓カード統合ビュー
- 卓カードに伝票の現在金額（POS料金設定で実計算）・伝票数・注文点数・伝票担当/顧客名・客名を表示
- カード🧾ボタン/会計アラートチップから伝票・会計モーダルへ直行（POS画面へ行かず会計完結）

### M3: 新規案内→席回しのシームレス連携
- タブレットの指名確定を **runTransaction 化**（オーダー記録＋卓反映が原子化。非Tx巻き戻り事故の根絶）。空席卓は「初回」として開卓
- 席回し画面に新規案内の**着信バナー**（onSnapshot・卓ジャンプ・確認済み✓）

### M2: 初回ローテーション運用の可視化
- **回す順番キュー**を常設（seating_meta.rotationOrder・↑↓並び替え・次に付く人を強調・配置で自動最後尾）
- 初回ピックアップ **PU バッジ**（回す順番・名簿の双方）
- **回し履歴**: 卓ごとに誰が何分付いたか（sessionLog・来店単位・上限30）

### M5: AI 席回し（ハイブリッド）
- `/api/ai/seating-suggest` 新設（Web 初の AI 配線。認証＋店舗メンバー確認＋クレジット予約/refund）
- 要望テキスト→理由つき提案カード→ワンタップ適用。`sanitizeAiPlan`（純関数）が制約違反（BOSS/ロック/欠勤/卓除外/本指名引き剥がし/重複）を全て落とす
- 純ロジック自動提案（設定ベース・無料）は理由表示つきで併存

### M6: UI磨き＋バグ修正
- **退店アンドゥ**（60秒トースト・空席のままの場合のみ復元する Tx ガード）
- POS「卓を初期作成」の既存卓上書き（フロア白紙化）バグ修正

### ゲート（2026-07-04 時点）
unit **80件** / rules 33件（CI GREEN run 28700766120）/ tsc EXIT0 / build EXIT0 / functions build EXIT0 / eslint **42 error（57→42 に純減・新規負債ゼロ）**

### 追加の人間確認事項
- 既存本番の personal_sales 控え（CF 旧仕様分）は dayKey/amount が無く個人売上画面に出ない。新規会計から自動解消。過去分を出すならバックフィルスクリプトの実行判断を
- AI 席回しは openrouter/ai-provider の env が本番に設定されている前提（未設定なら 500 になるだけで既存機能に影響なし）

---

## 追記（2026-07-05〜06）: 第2週 Day8〜10 ＋ 計算ベース采配エンジン

### 采配エンジン本格化（07-04 ユーザー指示「シンプルな計算AIで」）
- `generateSmartProposals`: スコアリング割当（指名/PU優先 × 回す順番の公平性 × ランク相性 × **NG組合せのハード制約**）。決定的・無料・LLM 不使用
- 采配モード3種（バランス/指名優先/新人育成・店舗共有）・キャスト編集に NG 相手設定
- LLM は自由要望の解釈専用に格下げ（sanitizeAiPlan にも NG 制約追加）

### Day8: 金の流れの一気通貫
- **POS→未収**: 会計フォームに「ツケ（未収あり）」→同一Txで売掛台帳へ自動起票（権限ロールのみ表示・rules 変更なし）。取消時は紐付く未収を連動削除。売上一覧にツケバッジ
- **予約→開卓**: 担当/席を実データセレクト化。「→来店済」で開卓＋当日連番＋指名キャスト本指名配置＋担当つきPOS初期伝票（会計→個人売上まで一本）
- バグ修正: 2名以上の待ち組案内が Firestore の undefined 拒否で常に失敗していた問題

### Day9: 人の流れの一気通貫
- **本入店連動**: 体験入店→名簿「新人」自動登録＋メンバー招待URL発行モーダル
- **顧客担当割当・キャスト別成績**: 完成済みAPI 3本（assign-customer/cast-customers/member-stats）に Web 画面を配線（顧客台帳のタブ＋編集ダイアログ）
- **チーム勤怠**: 全キャストの当日状況/月間合計/退勤忘れ警告（owner/manager）
- バグ修正: チーム勤怠の「本日」判定の日付規約ズレ（shifts.date=UTC暦日規約に統一）

### Day10: 見た目と細部の商品化
- **コミュニティ本番化**: バックエンド既定を firestore に反転（`=mock` 明示時のみモック・判定を1箇所に集約）。トップの表示 SOON→**LIVE**
- push-stats API が存在しない `crm_push_stats` を読んで**統計が常に空**だったバグ修正（→ `notification_push_stats`）
- テストデータの実在名を架空名（アオイ/ソラ/レン…）に全差し替え
- 実態合わせ: 通知の空状態文言（未実装機能を約束しない）/ 名刺発注は「保存・履歴管理まで（印刷連携は準備中）」を明示し beta 表記に
- LINE コード（api/auth/line/*）: login/signup から `isLineLoginEnabled` ゲート付きで参照が生きているため**削除見送り**（env 未設定なら UI 非表示＝実害なし。削除は人間判断）
- BUG-12（ローテ時 castStartTimes）: 仕様判断メモを `docs/bug-12-cast-start-times-memo.md` に作成（推奨=現状維持・最終判断はユーザー）

### マージ後に人間がやること（追加分）
6. **CF 再デプロイ**（sales-sync の個人控え修正・区分コピー）
7. **Vercel env 確認**: `NEXT_PUBLIC_COMMUNITY_BACKEND` — 既定が firestore になったため、未設定なら次のデプロイからコミュニティが本番モードで公開される（意図どおりか確認）
8. **コミュニティ板シード**: `node scripts/seed-community.mjs`（冪等・ADC 必要・本番 DB 書込のため要確認実行）
9. 旧 CF 個人売上控えの dayKey/amount バックフィル要否の判断
