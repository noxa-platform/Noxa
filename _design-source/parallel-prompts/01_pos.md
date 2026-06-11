# ① POS（販売時点管理）— UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。
NOXA OS 全体像・デザイン v1.1 トークン・禁止事項・完遂手順（goal）が書いてある。

## ゴール
yorulog の `src/app/(app)/pos/page.tsx` を、POS（オーダーエントリー）の**実画面 UI モック**に置き換える。
**決済機能は持たない**（注文 → 会計伝票出力までのガワ）。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/pos/page.tsx`（現状 ComingSoonModule のスタブ）
- 必要なら `src/components/modules/pos/` に分割コンポーネント新規作成可

## 画面仕様（ガワ）
タブレット横向き最適化（lg）+ モバイル縦積み（375px）の 3 ペイン構成：

1. **左ペイン: 卓選択**
   - 卓グリッド（卓番号 + 状態色: 空席=border のみ / 接客中=violet / 会計待ち=warning）
   - 選択中の卓をハイライト（glow-ring）
2. **中央ペイン: メニュー**
   - 上部カテゴリタブ（フード / ドリンク / ボトル / サービス / セット）
   - メニューカードのグリッド（品名・価格・タップで右の注文に追加する想定だが見た目だけ）
3. **右ペイン: 現在の注文 + 伝票**
   - 注文明細リスト（品名 × 数量 × 単価）
   - 小計 / サービス料 / 合計（tabular-nums、mono）
   - 「会計伝票を出力」ボタン（noxa-btn-primary、no-op）
   - 「卓を締める」ボタン（noxa-btn-secondary）

## モックデータ例
- 卓 8 つ（卓1〜8、状態バラバラ）
- メニュー: フード 6 / ドリンク 6 / ボトル 4 / サービス 3（例: 「ハイボール ¥900」「ドンペリ白 ¥80,000」「指名 ¥3,000」「セット 60分 ¥5,000」）
- 現在の注文: 3〜4 品（合計が伝票に出る）

## 完遂（goal）
00 の §7 に従い、実装 → tsc 0 → commit `feat(pos): POS オーダーエントリー UI モック実装` → push → `vercel --prod --yes` → playwright 確認 → サマリ報告まで自律実行。
