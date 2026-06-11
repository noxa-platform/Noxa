# HANDOFF: NOXA Channel（コミュニティ）実装・本番反映 — 2026-06-02

別セッション（コミュニティ担当）の作業引き継ぎ。POS / Firebase 基盤を触るメインセッション向け。
**結論：コミュニティ機能を NOXA Channel として実装し、本番 noxa-platform に反映済み（live）。** 競合しないための注意点を後半に記載。

---

## TL;DR（最初に読む）

- 機能名 **NOXA Channel**（通称は自然発生＝ノクチャ等）。招待制クローズド × 完全匿名の**掲示板**（板→スレ→レス）。
- 実装場所：`src/lib/community/`（データ層）＋ `src/components/community/`（UI）＋ `src/app/community/page.tsx`。
- **データ層は repository 抽象**。`NEXT_PUBLIC_COMMUNITY_BACKEND` で `mock`（既定）/`firestore` を切替。**ローカル開発は既定 mock＝認証不要で動く**。
- **本番は firestore**：`firestore.rules` に `noxa_*` 実装済み・index 2件追加・seed 投入済み・Vercel env 設定済み・`main`(429aeef) デプロイ済み。`https://noxa.egshugy.com/community` で稼働（AuthGuard でログイン必須）。
- **触ると壊れる/競合する点は「競合回避」セクション参照。**

---

## ブランド整理（このセッションで確定）

- **NOXA Core** … 業務系（POS・売上・給与・在庫…）※命名の系統名。個別機能は固有ブランド化しない
- **NOXA Channel** … コミュニティ（本ドキュメントの対象）
- **のみシュギ** … 別ブランドのまま（NOXA 配下に吸収しない）
- 仕様・戦略の**正本**：`web-knowledge/20_cases/noxa-app-mvp-and-community-launch-2026-05-22.md`（2026-06-02 追記済み）

---

## アーキテクチャ

```
src/lib/community/
  types.ts             ドメイン型（Board / Thread / Reply / タグ / 表示フラグ）
  constants.ts         タグ統制語彙・板・WEDGE設定・色トークン
  ng-words.ts          checkNg(text) -> {hard, soft}（2段階）
  repository.ts        CommunityRepository インターフェース（非同期）
  mock-repository.ts   インメモリ実装（既定。シードで「人がいる感」）
  firestore-repository.ts  Firestore 実装（noxa_* / トランザクション）
  anon-id.ts           匿名ID生成（日替わり・板単位）
  store.ts             useCommunity(uid?) フック＋createCommunityRepository()（差し替え点）
src/components/community/
  CommunityClient.tsx  オーケストレーター（useCommunity を消費）
  CommunityGate.tsx    firestore時はAuthGuardで囲う／mock時はそのまま
  BoardList / ThreadList / ThreadDetail / PostBlock / composers / ui
src/app/community/page.tsx  CommunityGate を描画（metadata: NOXA Channel）
```

**重要原則**：UI は `CommunityRepository` インターフェースにしか依存しない。バックエンド差し替えは `store.ts` の `createCommunityRepository(uid)` だけ。

---

## Firestore スキーマ（noxa_* 名前空間）

- `noxa_boards/{boardId}` … 板（name/desc/order/threadCount/postsToday/lastActivityAt/featured/wedge）
- `noxa_posts/{postId}` … スレッド（boardId/title/body/**authorUid**/areaTag/jobTag/pinned/official/likeCount/commentCount/createdAt/lastActivityAt）
- `noxa_comments/{commentId}` … レス（postId/resNo/**authorUid**/body/areaTag/jobTag/likeCount/createdAt）
- `noxa_likes/{uid_kind_id}` … いいね（存在＝いいね済み。トグルで create/delete＋カウンタ increment）
- `noxa_reports/{reportId}` … 通報（受付のみ）
- `noxa_meta/community_seed` … seed 冪等マーカー

**rules（`firestore.rules`、実装済み）**：既存ブロックは不変更、`noxa_*` 予約ブロック（旧 `if false`）を実装。認証必須・本人 uid 縛り・更新は likeCount/commentCount/lastActivityAt 限定・`official` はクライアント詐称不可（create 時 official==false 強制、admin は可）。`noxa_invites / noxa_users / noxa_user_settings` は **まだ `if false`**（招待は未実装）。

**index（`firestore.indexes.json`）**：`noxa_posts(boardId ASC, lastActivityAt DESC)` と `noxa_comments(postId ASC, resNo ASC)` を追加。クエリは boardId+lastActivityAt のみ、ピン留め優先・タグ絞り込みはクライアント側（index 増殖回避）。

---

## 正体（匿名）の仕組み — 確定仕様

- 表示は完全匿名「名無しさん」。**内部 authorUid は保持**（モデレーション/開示請求専用、UI には絶対出さない）。
- **匿名ID＝日替わり・板単位（5ch風）**：`anonId(uid, boardId, dayKey[JST])`。同日同板で同一人物＝同ID、日が変われば別ID。
- 表示フラグは**サーバ側で内部 uid を比較**して算出（他人の uid を client に渡さない）：
  - `isThreadAuthor`（>>1 と同一投稿者＝「スレ主」バッジ）
  - `isMine`（閲覧者本人＝本人にだけ「自分」表示、自分の投稿は通報不可）
  - `official`（運営投稿＝「運営」表示）

---

## モデレーション — 確定仕様

- **NG 2段階**（`ng-words.ts`）：
  - hard（ブロック・投稿不可）：重大語（援交/売春/枕営業/未成年等）＋連絡先（URL/メール/電話/LINE交換）
  - soft（警告・続行可＝本人責任）：改正風営法ワード（No.1/億プレイヤー/スカウトバック等）
- **通報は受付のみ**（noxa_reports に作成）。通報3回で自動非表示は**未実装**（次フェーズ）。

---

## 招待の仕組み — 設計確定（★コードは未実装。実装はメイン側 or 次セッション）

- 方式：運営発行コード＋既存会員招待のハイブリッド
- 枠は**ダイヤル制**：シード期は太く→成長期に月1へ絞る→成熟期に公開化検討（`inviteCredits` で運営が増減）
- 形：**ワンタイムリンク主体**（X DM/LINE）＋コード手入力併用。1回使い切り・7日失効・使用時に招待元へ通知
- **連帯責任＝廃止**（招待元への自動ペナルティ一切なし。`banWarningCount` 不要）
- **手動の最終手段あり**：運営が手動で**招待発行権だけ停止**できる（罰でなく信頼ベース、本人はBANしない）
- 招待ツリー：`invitedBy` を**監査用に記録**（責任は問わないが荒らしクラスタ検知に使う）
- 多重アカ：MVPは UID＋IP記録のみ（デバイスIDは後）
- 想定コレクション：`noxa_invites/{code}`（issuedBy/issuedAt/expiresAt/usedBy/usedAt/status）、`noxa_users/{uid}`（invitedBy/invitedAt/inviteCredits/lastInviteIssuedAt）

---

## 本番反映の状態（2026-06-02 時点）

- ✅ `firebase deploy --only firestore:rules,firestore:indexes`（project=noxa-platform）
- ✅ seed 投入（板6＋シードスレ3＋レス）。`noxa_meta/community_seed` で冪等
- ✅ Vercel production env `NEXT_PUBLIC_COMMUNITY_BACKEND=firestore`
- ✅ `main`(429aeef) に反映＋`vercel --prod` 済み。`https://noxa.egshugy.com/community` live（ログイン必須）
- 確認方法：未ログインで `/community` → `/account/login?redirect=...` に飛べば firestore モード正常

---

## 競合回避（メインセッションへの注意）★重要

1. **firestore.rules は同一ファイルを共有**。コミュニティ分は `noxa_*` ブロックのみ。**既存（account_/shop_/crm_ 等）は触っていない**。ルール変更時は両者の追加が消えないよう注意（既存ブロック破壊禁止・追加のみ）。
2. **ローカルリポは共有**。ブランチ切替（`git checkout`）は相手の作業ツリーを壊すので、main への反映は `git push origin HEAD:main`（FF push、切替なし）推奨。
3. **seed の実行**：noxa 直下に firebase-admin が無いので、**隔離環境（/tmp に npm i firebase-admin）＋ ADC（`gcloud auth application-default login`）**で `scripts/seed-community.mjs --with-threads` を実行した。再投入は冪等。
4. **mock 既定**：env を設定しない限り mock。ローカルでコミュニティを触っても Firestore は汚れない。
5. **いいねトグルは setState 更新関数をネストしない**こと（React19 StrictMode の二重実行で likeCount が +2 になるバグを踏んで修正済み。`store.ts` の `toggleLike` 参照）。

---

## 未実装 / 次の入口（TODO）

- [ ] 招待システムの実コード（`noxa_invites`/`noxa_users` 拡張、rules を `if false` から実装、ワンタイムリンク、inviteCredits、手動発行権停止）
- [ ] 通報3回で自動非表示（reportCount＋重複除去）
- [ ] 1ウェッジ運用（非ウェッジ板の「準備中」ロック等。現状は全板開放）
- [ ] ログイン後の実画面 QA（テストアカウント要）
- [ ] `/account/login` の軽微な 404（既存アセット、コミュニティ無関係だが気づいた点として）

---

## 参照

- ブランチ：`feat/community-board`（= origin/main 429aeef にFF反映済み）
- 仕様正本：`web-knowledge/20_cases/noxa-app-mvp-and-community-launch-2026-05-22.md`
- 本番：`https://noxa.egshugy.com/community`（firestore・ログイン必須）
