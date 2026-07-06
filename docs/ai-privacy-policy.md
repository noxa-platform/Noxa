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
| `ai/sales-message` / `briefing` / `insights` / `feedback` | 集計値・自分のデータ中心 | 送信内容に連絡先なし |
| `ai/benchmark` / `ai/models` | admin 限定の運営ツール（顧客データなし） | 対象外 |

## orphan API の処分判定（Day12・削除はしない）

- `ai/suggest`: Web からの参照ゼロだが、認証＋クレジット消費つきの完成 API で **iOS から呼ばれている可能性**がある。削除せず PII ガードのみ適用（本ページの表のとおり）。
- `ai/models` / `ai/benchmark`: admin 限定（isAdmin email 検証）の運営ツール。危険性なし・温存。

## 同意文言（案・UI 実装はバックログ）

> AI 機能は、顧客メモ・来店履歴などの情報を AI サービス（外部 API）に送信して提案を生成します。電話番号・メールアドレスは自動的に伏せ字にされますが、メモにはお客様の本名・住所・LINE ID を書かないことをおすすめします。

配置候補: AI 機能の初回利用時ダイアログ／設定 > AI。
