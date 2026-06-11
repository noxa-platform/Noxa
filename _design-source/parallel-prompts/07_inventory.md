# ⑧ 在庫管理 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/inventory/page.tsx` を、在庫管理（在庫リスト + 発注アラート + ボトルキープ）の**実画面 UI モック**に置き換える。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/inventory/page.tsx`
- 必要なら `src/components/modules/inventory/` に分割

## 画面仕様（ガワ）
1. **発注アラート（上、目立たせる）**
   - 閾値割れ品のカード列（品名 / 残数 / 閾値 / 「発注」ボタン）。warning / error 色
2. **在庫リストテーブル（メイン）**
   - 品名 / カテゴリ（ボトル・食材・消耗品）/ 在庫数 / 閾値 / 状態バッジ（十分=success / 少=warning / 切れ=error）
   - カテゴリフィルタタブ
3. **ボトルキープ一覧（下）**
   - 客名 / 銘柄 / キープ日 / 期限 / 残量（期限間近は warning）

## モックデータ例
- 在庫 15 品（状態混在）、うち 3 品が閾値割れ
- ボトルキープ 8 件（うち 2 件が期限間近）

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(inventory): 在庫管理 UI モック実装`。
