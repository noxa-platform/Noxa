# ⑦ 送迎 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/transport/page.tsx` を、送迎（配車ボード + リクエスト一覧）の**実画面 UI モック**に置き換える。ロジックなし、モックデータのみ。地図は実 API を使わずプレースホルダ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/transport/page.tsx`
- 必要なら `src/components/modules/transport/` に分割

## 画面仕様（ガワ）
1. **配車ボード（上）**
   - 車両 × ドライバー × 現在ステータス（待機 / 送迎中 / 戻り中）のカード列
2. **送迎リクエスト一覧（メイン）**
   - リクエスト行: 時刻 / 種別（同伴ピックアップ / 退勤送迎）/ 行き先 / 客名 or キャスト名 / ステータスバッジ
   - 「配車する」ボタン（noxa-btn、no-op）
3. **地図プレースホルダ（右 or 下）**
   - 角丸の暗いボックスに「Map preview」表記 + ダミーのピン（CSS の点）。実地図 API は使わない

## モックデータ例
- 車両 3 台（アルファード等のダミー名）、ドライバー 3 名
- 送迎リクエスト 5 件（同伴 2 / 退勤 3）

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(transport): 送迎 UI モック実装`。
