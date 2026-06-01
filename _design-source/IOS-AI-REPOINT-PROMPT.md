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
