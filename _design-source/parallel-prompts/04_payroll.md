# ⑤ 給与計算 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/payroll/page.tsx` を、給与計算（明細 + 月締めテーブル）の**実画面 UI モック**に置き換える。計算ロジックは実装せず、モックの確定値を表示するだけ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/payroll/page.tsx`
- 必要なら `src/components/modules/payroll/` に分割

## 画面仕様（ガワ）
1. **上部コントロール**
   - 対象月セレクト（2026年5月 等、UI のみ）+ 対象キャストセレクト
2. **給与明細カード（メイン）**
   - 内訳を行で表示（tabular-nums、mono）:
     売上歩合 / 時給 / 同伴バック / 指名バック / アフターバック ＝ 加算
     遅刻罰金 / 欠勤罰金 / 立替・前借り ＝ 減算
   - 最下部に「差引支給額」を大型表示（Cormorant、cyan-mist glow）
3. **全スタッフ月締めテーブル（下）**
   - キャスト × 総支給 × 控除 × 差引のテーブル、合計行
   - 「PDF 出力」「振込データ出力」ボタン（noxa-btn、no-op）

## モックデータ例
- 1 キャストの明細（例: 売上歩合 ¥420,000 / 時給 ¥96,000 / 同伴 ¥30,000 / 罰金 -¥5,000 / 差引 ¥541,000）
- スタッフ 6 名分の月締め行

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(payroll): 給与計算 UI モック実装`。
