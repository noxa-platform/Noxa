# yorulog-ios へ投げる作業 Prompt — AI エンドポイントの向き先を NOXA へ

> これは **yorulog-ios（SwiftUI）リポの別セッション**に貼って使う作業指示です。
> このワークスペース（egshugy-products）からは iOS を改変しません。

---

## 背景（このまま貼ってOK）

YoruLog の AI バックエンド（`/api/ai/*`）を **yorulog Web（`yorulog.vercel.app`）→ NOXA（`noxa.egshugy.com`）** へ移設します。

- Firebase プロジェクトは同一（`noxa-platform`）。**認証はこれまでどおり Firebase ID トークン**で通る（再ログイン不要）。
- **AI のパス（`/api/ai/*`）・リクエスト/レスポンス形式・SSE ストリーミング仕様は不変**。変わるのは**ホスト（ベースURL）だけ**。
- yorulog Web は当面プロトタイプとして残すため、**AI 以外のエンドポイント（auth/line, missions, referral, iap, account, barapp, calendar）は当面 yorulog のまま**。AI だけ先に NOXA へ向ける。
- 前提: NOXA 側に AI ルートが本番デプロイ済み（env 設定済み）になってから iOS を切り替える。

## やること

### 1. `YoruLog/Core/Constants.swift` に AI 専用ベースURLを追加
現状は単一の `webBaseURL`（`https://yorulog.vercel.app`）から全 API を組み立てている。AI だけ別ホストに向けるため、専用の base と helper を足す。

```swift
// 既存はそのまま
static let webBaseURL = URL(string: "https://yorulog.vercel.app")!

// 追加: AI 専用（移設先 NOXA）
static let aiBaseURL = URL(string: "https://noxa.egshugy.com")!
static func aiApi(_ path: String) -> URL {
    aiBaseURL.appendingPathComponent("api").appendingPathComponent(path)
}
```

> 安全に切り戻せるよう、フラグで出し分け可能にしておくと良い：
> `static let useNoxaAI = true`（false で旧 `api(...)` に即フォールバック）。

### 2. AI 呼び出しだけ `aiApi(...)` に差し替え
`api(...)` → `aiApi(...)` に変更する。対象ファイル（既知）:
- `YoruLog/AI/AIService.swift`
- `YoruLog/AI/AIChatStreamClient.swift`（`/api/ai/chat` の SSE）
- `YoruLog/AI/AIThreadService.swift`（`/api/ai/threads`, `/threads/{id}`）
- `YoruLog/AI/ChatHistoryService.swift`（`GET/DELETE /api/ai/chat/history`）
- `YoruLog/Customers/AiInferProfileSheet.swift`（`/api/ai/customer-infer-profile`）
- `YoruLog/Customers/AIMessageDraftSheet.swift` / `CustomerDetailView.swift`（実装時 `/api/ai/message`）
- `YoruLog/AI/ContextExtractDialog.swift` 周辺（`/api/ai/customer-context-extract`）

向き先を変える AI パス（網羅）:
`/api/ai/chat`(SSE), `/api/ai/chat/history`, `/api/ai/threads`, `/api/ai/threads/{threadId}`,
`/api/ai/message`, `/api/ai/message/reply`, `/api/ai/message/analyze`,
`/api/ai/learn-from-text`, `/api/ai/customer-context-extract`, `/api/ai/customer-infer-profile`,
`/api/ai/profile-extract`, `/api/ai/briefing`, `/api/ai/feedback`,
（使っていれば）`/api/ai/insights`, `/api/ai/suggest`, `/api/ai/sales-message`, `/api/ai/tags`。

### 3. 認証ヘッダは不変
`Authorization: Bearer <Firebase ID トークン>` のまま（同 `noxa-platform`）。トークン取得・更新ロジックは変更不要。

### 4. SSE（`/api/ai/chat`）
`text/event-stream`（chunk / meta / error イベント）。NOXA でも仕様同一。ホストが変わるだけなので、ストリーム受信が NOXA 相手でも動くことを実機確認。

### 5. 注意点
- `Core/Networking/APIClient.swift` のコメントに `yorulog.app` とあるが、実際の定数は `yorulog.vercel.app`。**着手前に Constants.swift の実値を確認**。
- リクエスト/レスポンスの Codable モデルは**変更しない**（ペイロード不変）。
- Firestore 書込先（`ai_threads`, `personal_ai_threads` 等）は同一 `noxa-platform` なので、移行後もデータは同じ場所に残る。

### 6. テストチェックリスト（NOXA 相手に実機/シミュレータ）
- [ ] チャット送信＋ストリーミング表示
- [ ] スレッド 作成/一覧/削除
- [ ] チャット履歴 取得/削除
- [ ] スクショ→返信案（message/reply）
- [ ] スクショ→会話解析（message/analyze）
- [ ] 顧客コンテキスト抽出（customer-context-extract）
- [ ] プロフィール抽出（profile-extract）
- [ ] ブリーフィング（briefing）／フィードバック（feedback）
- [ ] 401/403 が出ないこと（同 Firebase トークンで通ること）

### 7. ロールアウト
- まず `useNoxaAI` を内部ビルドで true にして検証 → 問題なければ本番。
- NOXA AI に問題が出たら `useNoxaAI=false` で即 yorulog に戻す。
- AI 以外も NOXA 移設が完了したら、最終的に `webBaseURL` 自体を NOXA に切替えて `aiBaseURL` を畳む。

---

## NOXA 側の前提（iOS 切替の前に Web チームが完了させること）
1. `noxa/src/app/api/ai/*` に AI ルートを移設し本番デプロイ（**プロバイダは OpenRouter。Gemini は廃止＝移植時に gemini.ts / @google/generative-ai / フォールバック分岐を除去**）
2. noxa(Vercel) に AI env を設定（**OpenRouter のみ**）:
   - `OPENROUTER_API_KEY`（必須）
   - `OPENROUTER_HTTP_REFERER` / `OPENROUTER_X_TITLE`
   - `AI_PRIMARY_MODEL_FAST` = `openrouter:<provider/model>`（例 `openrouter:anthropic/claude-...`）
   - `AI_PRIMARY_MODEL_THINK` = `openrouter:<provider/model>`
   - `FIREBASE_SERVICE_ACCOUNT_KEY`（Admin SDK）
   - ※ `GEMINI_API_KEY` は不要（Gemini 廃止）
3. AI ルートが native（Origin 無し）リクエストを拒否しないこと（CORS/Origin チェックを緩める）
4. `noxa.egshugy.com/api/ai/chat` で SSE が流れることを確認（OpenRouter ストリーミング）
5. 画像解析（message/reply・analyze・customer-context-extract・profile-extract）は OpenRouter のビジョン対応モデルが必要（`image_url` 形式で送信済み）。FAST/THINK に画像対応モデルを設定すること

---

## 追記: IAP（課金）も NOXA へ向ける

NOXA 側は **IAP ルートも本番稼働済み**（`/api/iap/products`=200, `/grant`=401(認証), `/notifications-v2`=400(空payload)）。
DB は yorulog と共有・`account_iap_transactions` は transactionId 冪等・`account_subscriptions` は increment なので、
**yorulog 経由でも NOXA 経由でも同じ結果**＝移行は低リスク＆切り戻し容易。NOXA 側に追加の必須 env は無い
（`APPLE_IAP_BUNDLE_ID` は未設定なら検証skipの寛容実装。設定したい場合は実バンドルIDを noxa Vercel に入れるとより厳格）。

### iOS でやること
1. `Constants.swift` のルーティングを、`ai/` に加えて `iap/` も NOXA へ向ける:
   ```swift
   // 例: AI と IAP を NOXA、それ以外は当面 yorulog
   let onNoxa = path.hasPrefix("ai/") || path.hasPrefix("iap/")
   let base = (useNoxaAI && onNoxa) ? aiBaseURL : webBaseURL
   ```
   - 対象: `IapStore`(`POST iap/grant`)・`IapProductService`(`GET iap/products`)
2. 認証・ペイロード・StoreKit ロジックは不変（ホストだけ変更）。
3. テスト: サンドボックス購入 → `iap/grant` が NOXA で 200 → `account_subscriptions` のクレジット加算を確認。
4. ※ AI 以外（auth/line, missions, referral, account, calendar, barapp）も NOXA に移植済みなので、
   将来は `let base = noxaBaseURL`（全 `webBaseURL` を NOXA へ）に一本化して `aiBaseURL` を畳める。
   LINE/Calendar/GooglePlay は鍵未設定で元々非稼働（移しても挙動同じ）。

### App Store Connect でやること（あなたのコンソール作業）
- **App Store Server Notifications V2 の Production URL** を
  `https://noxa.egshugy.com/api/iap/notifications-v2` に変更。
- Sandbox URL も同様に（テスト用）。
- Apple は本番1URLのみ＝単一切替だが、コード同一＋DB共有のため切り戻し可。取りこぼしは
  App Store Server API の Notification History で再取得可能。
- 切替後しばらくは Firestore の `account_subscriptions` 更新が継続しているか監視。

---

# 【本命】iOS を全部 NOXA に一本化する（webBaseURL を NOXA へ）

> yorulog Web の **全 API ルートは NOXA に移植・本番稼働済み**。iOS が叩く全エンドポイントが
> NOXA に存在することを照合済み（不足ゼロ＝flip しても 404 は出ない）。よって AI/IAP だけでなく
> **`webBaseURL` 自体を NOXA に切り替えて一本化**できる。これが最終形。

## 照合結果（iOS が叩く → NOXA に在る）
`ai/*`（chat/threads/message/各extract/briefing/insights/feedback/parse/sales-message/suggest/tags）、
`iap/grant`・`iap/products`、`missions/trigger`、`referral/code`・`referral/redeem`、`calendar/events` … **すべて NOXA にあり**。

## iOS でやること
1. `Constants.swift` を一本化:
   ```swift
   // 一本化: 全 API を NOXA へ
   static let webBaseURL = URL(string: "https://noxa.egshugy.com")!
   // aiBaseURL / useNoxaAI / onNoxa の特別分岐は不要になるので撤去 OK。
   // api(path) は従来どおり webBaseURL から組み立てる:
   static func api(_ path: String) -> URL {
       webBaseURL.appendingPathComponent("api").appendingPathComponent(path)
   }
   ```
   - 切り戻し保険を残すなら `webBaseURL` を 1 行差し替えるだけで yorulog に戻せる形にしておく。
2. **認証は不変**（Firebase ID トークン・同 `noxa-platform`）。再ログイン不要。
3. **メールリンクサインインの継続 URL に注意**（唯一の別扱い）:
   `AuthService.swift` の `actionCodeSettings.url = https://yorulog.vercel.app/login?...`。
   - これは Firebase の email-link 着地ページ。NOXA に同等の着地（`https://noxa.egshugy.com/account/login` 等）が
     あることを確認してから変更する。未確認なら**当面 yorulog のまま**で可（プロトタイプとして残すため動く）。
   - Firebase コンソールの「承認済みドメイン」に `noxa.egshugy.com` が入っていること（既に追加済みのはず）。
4. **非稼働機能は移しても同じ**: LINE ログイン / Google カレンダー / Google Play 課金は鍵が
   yorulog 本番にも無く元々非稼働。NOXA でも同様（退行ではない）。使う時に鍵設定＋各コンソール登録。

## テスト（NOXA 一本化後・実機）
- [ ] ログイン（既存トークンで継続／必要なら再ログイン）
- [ ] AI チャット（ストリーミング）＋画像解析
- [ ] IAP（サンドボックス購入 → クレジット加算）
- [ ] ミッション / 紹介コード（missions/trigger, referral/*）
- [ ] 顧客同期・各画面が 401/404 なく動く

## App Store Connect（IAP を NOXA 処理にするなら・上の IAP 節と同じ）
- Server Notifications V2 の Production/Sandbox URL を `https://noxa.egshugy.com/api/iap/notifications-v2` に。

## ロールアウト指針
1. 内部ビルドで `webBaseURL=NOXA` にして全テスト → OK なら本番。
2. 問題が出たら `webBaseURL` を `https://yorulog.vercel.app` に戻すだけで即復旧（yorulog は残置）。
3. 全機能 NOXA で安定後、yorulog バックエンド（functions/rules/API）を撤去。yorulog Web 自体はプロトタイプとして残す。
