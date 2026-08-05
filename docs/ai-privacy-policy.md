# AI への顧客情報送信ポリシー（棚卸しと実装・Day12）

外部 AI（OpenRouter 経由の LLM）へ送る顧客情報の方針と、ルートごとの実態の正本。
実装は `src/lib/ai-privacy.ts`（allowlist 抽出 `pickForAi` ＋ 連絡先マスク `maskContactInfo`）。

## 方針

1. **連絡先（電話・メール・住所・LINE ID）は AI に送らない。** Firestore doc の丸ごと送信は禁止し、allowlist（`AI_CUSTOMER_FIELDS` / `AI_LOG_FIELDS`）で必要フィールドだけを抽出する。
2. **フリーテキスト（メモ・好み等）に書かれた電話番号・メールは送信前に機械マスク**（`[電話番号非表示]` / `[メール非表示]`）。
3. **LINE ID・住所は機械検出が困難**（一般文字列と区別できず誤爆する）。メモ欄に書かない運用を推奨し、UI 文言・オンボーディングで案内する（バックログ）。
4. 氏名は接客提案の中核文脈のため送る。**源氏名・ニックネームでの登録を推奨**（本名フルネームを避ける）。
5. ユーザー明示入力（プロンプト・取り込みテキスト）はユーザーの意思で送信されるものとして対象外。ただし応答に電話番号を復唱させない旨は各 system prompt の責務。

## ルート別棚卸し（2026-07-07 時点）

| route | 顧客データの送信 | 対応 |
|---|---|---|
| `ai/suggest` | 旧: **doc 丸ごと＋logs 丸ごと**（電話等を含み得た） | ✅ allowlist＋マスクに修正（Day12） |
| `ai/chat` | フィールド選抜済み（連絡先フィールドなし）。メモ系フリーテキストあり | ✅ maskDeep 適用（Day12） |
| `ai/message` | フィールド選抜済み。メモ・ログの memo あり | ✅ maskContactInfo 適用（Day12） |
| `ai/insights-narrative` | セグメント集計＋サンプル名（ニックネーム前提の注記済み） | ✅ 現状で方針適合 |
| `ai/seating-suggest` | 盤面（キャスト名・卓状態）のみ。顧客連絡先なし | ✅ 対象データなし |
| `ai/customer-extract` / `customer-context-extract` / `learn-from-text` / `parse` / `profile-extract` / `tags` | ユーザーが明示的に貼り付けたテキストから抽出する機能（入力がユーザー提供） | 方針5で対象外 |
| `ai/sales-message` | 集計値・自分のデータ中心 | 送信内容に連絡先なし |
| `ai/briefing` / `insights` / `message/reply` / `customer-infer-profile` | 顧客プロファイル・ログ memo・LINE 会話本文を送信（Day12 では素通しだった） | ✅ マスク適用（Day99）＋網羅ガード `test/lib/ai-pii-mask-coverage.test.ts` |
| `ai/feedback` | ワークスペース内の記録は自分のデータ。**加えて opt-in 時は横断コレクション `ai_knowledge/*` へ書き出す**（下記） | ✅ 寄与 source を allowlist 化（Day101） |
| `ai/benchmark` / `ai/models` | admin 限定の運営ツール（顧客データなし） | 対象外 |

## ワークスペース横断の匿名化集合学習（`ai_knowledge/*`・Day101 追記）

Day12 の棚卸しは「外部 AI へ何を送るか」だけを見ており、**自社 Firestore 内での横断共有**が抜けていた。
`api/ai/feedback` は 👍/👎 のうち opt-in ワークスペースのものを、`ai_knowledge/patterns/entries`（伏字化テキスト）と
`ai_knowledge/aggregates/buckets/*`（カウンター）へ書き出す。ここは **workspaceId を保存しない共有コレクション**で、
書いた内容は `ai/message` / `ai/message/reply` のプロンプトに「他ワークスペースの成功パターン」として載る。

方針:

1. **寄与できる source は allowlist**（`reply` / `message` の返信案のみ）。読み出し側がこの2つしか引かないため、
   それ以外（`chat` = 経営アシスタントの回答。売上・顧客名・メモを含む長文）を書いても**誰も読まないまま横断コレクションに残るだけ**だった（Day101 で是正）。
2. 原文は保存せず `sanitizePii()` 済みテキストのみ・**2000字上限**（他社プロンプトに載るため）。
3. 集計キー（`{source}_{scene}_{storeType}_{up|down}`）はクライアント入力を含むため、`/` を含む値では集計をスキップする（別 doc の書き換え防止）。
4. opt-in は `shop_shops/{wid}.aiContribution`。**新規店舗作成時の既定が true**（`src/app/store/new/page.tsx`）＝実質全店が寄与対象なので、寄与範囲は狭く保つ。
5. 未解決（要ユーザー判断）: `output` はクライアントが自由に送れる文字列で、サーバは「本当に AI が生成したか」を検証していない。
   悪意ある利用者が 👍 付きで任意テキストを送れば、他ワークスペースのプロンプトへ混入させ得る（cross-tenant prompt injection）。
   現状の緩和はプロンプト側の注記と上記の長さ上限のみ。恒久対策（生成物との照合や公開前モデレーション）は設計判断。

## orphan API の処分判定（Day12・削除はしない）

- `ai/suggest`: Web からの参照ゼロだが、認証＋クレジット消費つきの完成 API で **iOS から呼ばれている可能性**がある。削除せず PII ガードのみ適用（本ページの表のとおり）。
- `ai/models` / `ai/benchmark`: admin 限定（isAdmin email 検証）の運営ツール。危険性なし・温存。

## 同意文言（案・UI 実装はバックログ）

> AI 機能は、顧客メモ・来店履歴などの情報を AI サービス（外部 API）に送信して提案を生成します。電話番号・メールアドレスは自動的に伏せ字にされますが、メモにはお客様の本名・住所・LINE ID を書かないことをおすすめします。

配置候補: AI 機能の初回利用時ダイアログ／設定 > AI。
