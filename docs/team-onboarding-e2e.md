# チーム導入 E2E 手順書（招待→打刻→POS→売上→給与）

Day4/Day5 で実装した「店舗がチームで導入」フローの通し検証手順。Day7 の統合検証と本番導入時のチェックリストを兼ねる。

## 前提
- オーナーアカウント（店舗作成済み）と、キャスト用の別アカウント（NOXA アカウント）を用意。
- rules は grind/fable-week の firestore.rules（members 自己登録封鎖＋invites read 制限）を反映済みであること。

## 手順

### 1. 招待の発行（オーナー）
1. オーナーで `/store/settings` を開く →「メンバーと招待」セクション。
2. role「キャスト」を選び「招待リンクを発行」→ URL をコピー。
3. 期待: 未使用の招待一覧にコードが出る。`shop_shops/{shopId}/invites/{code}` が作成される（role/createdBy/expiresAt、usedBy 無し）。

### 2. 招待の受諾（キャスト）
1. キャストのブラウザ（別アカウント）で招待 URL `/store/join?shop=…&code=…` を開く。
2. 未ログインならログイン誘導 → ログイン後、源氏名を入力し「参加する」。
3. 期待:
   - `members/{castUid}` が `{role:'cast', castDisplayName, invitedBy, addedVia:'invite'}` で作成される。
   - `seating_casts` に uid 紐付けの名簿ができる（同名未紐付けがあればそこに uid が付く）。
   - `invites/{code}` に usedBy/usedAt が付く。同じコードの再使用は 409。
   - 期限切れコードは 410、存在しないコードは 404。

### 3. 打刻（キャスト）
1. キャストで `/attendance` → 出勤 → （営業後）退勤。
2. 期待: `shop_shops/{id}/shifts` に `{castUid, date, startAt, endAt}`。

### 4. POS 会計 → 売上
1. 卓にキャストを配置（席回し）→ POS で注文 → 会計。
2. 期待: `sales` に castUid 付きで記録。キャストの個人側にも同期（CF syncShopSaleToPersonal）。

### 5. 給与確定（オーナー/店長）
1. `/payroll` で当月を開く。
2. 期待: 紐付け済みキャストに **時給×時間の基本給が出る**（¥0 でない）。時給が 0 の場合は席回し名簿で時給を設定。
3. dryRun プレビュー → 確定 → `payrolls/{castUid}/items/{YYYY-MM}`。

### 6. 権限の境界（ネガティブ確認）
- 招待リンクなしの第三者が `members` に自己登録できないこと（rules テスト day4-invites で自動化済み）。
- cast が `/store/settings` の招待発行 API を叩いても 403。
- 使用済み招待の再利用が 409。

## 自動化済みの検証
- rules 層: `test/rules/day4-invites.rules.test.ts`（CI で実行）
- API 層: issue-invite / redeem-invite は Admin SDK のためローカル単体テスト不可（本番/エミュレータ E2E で確認）
