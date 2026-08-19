# AI エンドポイント棚卸し（Day126・2026-08-19）

「無料でばらまき、生成系だけ有料」という方針を成立させるには、**無料機能の原価が見えている**
必要がある。19 経路（`src/app/api/ai/*`）を機械的に走査した結果と対応。

## 走査軸

| 軸 | 何を見るか | なぜ |
|---|---|---|
| LLM | 実際に `generateText` / `generateChat` / `analyzeImages` を呼ぶか | 原価が発生する経路の特定 |
| CREDIT | `reserveAiCredit` でクレジットを消費するか | 課金対象か |
| LEDGER | `account_credit_ledger` に記録が残るか | **原価が見えるか**（課金と別問題） |
| AUTH | 認証・アクセス文脈の解決があるか | 他店のデータを読ませない |
| PII | `ai-privacy` のマスクを通すか | 顧客の個人情報を外部モデルへ送らない |
| WRITE | AI 出力を Firestore へ書くか | 捏造値がデータを汚さないか |

## 結果（Day126 時点）

| エンドポイント | LLM | CREDIT | LEDGER | 備考 |
|---|---|---|---|---|
| chat | ✓ | ✓ | ✓ | 文字数・画像枚数で従量（`ai-cost.ts`） |
| insights / message / sales-message / suggest / tags | ✓ | ✓ | ✓ | 課金あり |
| learn-from-text | ✓ | ✓ | ✓ | 出力を `[AI 日付]` タグ＋文字数上限つきで書き戻し（良い形） |
| briefing | ✓ | – | **追加** | 無料。原価記録のみ |
| customer-extract | ✓ | – | **追加** | 同上 |
| customer-context-extract | ✓ | – | **追加** | 画像解析（原価が重い） |
| customer-infer-profile | ✓ | – | **追加** | 同上 |
| insights-narrative | ✓ | – | **追加** | 同上 |
| parse | ✓ | – | **追加** | 同上 |
| profile-extract | ✓ | – | **追加** | 画像解析 |
| seating-suggest | ✓ | – | **追加** | 同上 |
| benchmark / models | – | – | – | LLM を呼ばない |
| feedback / threads | – | – | – | 記録・履歴 CRUD |

## Day126 で直したこと

**8 経路がクレジットも台帳記録も無しで LLM を呼んでいた。** 課金しないのは方針として妥当だが、
**原価が 1 円も見えない**状態だったため「無料で何店まで配れるか」を判断できなかった。
`logAiUsage(uid, feature)` を追加し、`amount: 0` / `charged: false` で利用事実だけを残す。
課金集計は `amount` の和なので既存の請求には影響しない。

## 残っている課題（未対応・要判断）

1. ~~PII マスクを通していない経路がある~~ → **Day127 で対応済み**。
   分類ガード（`test/lib/ai-pii-mask-coverage.test.ts`）自体は Day99/103 から存在したが、
   **「ユーザーが貼り付けたテキストは免除」という分類が穴**だった。免除の根拠は
   「保存済みの顧客フリーテキストを載せないから」なのに、貼り付けられるのは LINE の
   トーク履歴そのもの＝保存済みメモより PII が濃い。`customer-extract` / `learn-from-text` /
   `parse` にマスクを適用し、来店ログの memo を素通ししていた `tags` を MASKED へ再分類。
   画像のみの 3 経路は**機械的にマスク不能**なので `IMAGE_ONLY` として明示的に切り出し、
   同意文言と UI の注意書きで担保する領域だと分かるようにした。
2. **画像解析（analyzeImages）が無料のまま**。テキストより原価が 1 桁重い。
   `customer-context-extract` / `profile-extract` は課金対象にするかの判断が要る。
3. **生成系（サイト・LP）の課金単位**。クレジット（1 ≈ ¥0.1 原価想定）は chat 向けの尺度で、
   サイト 1 枚生成には合わない。成果物単位の価格にする方針。
4. **モデルルーティング**が経路ごとの直指定。タスク難度による自動振り分けは未実装。
