# ③ 席回し — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/seating/page.tsx` を、席回し（フロアマップ + キャストローテーション）の**実画面 UI モック**に置き換える。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/seating/page.tsx`
- 必要なら `src/components/modules/seating/` に分割

## 画面仕様（ガワ）
1. **フロアマップ（メイン）**
   - 卓を矩形カードで配置（CSS grid でフロアを表現、絶対座標でなくグリッドでよい）
   - 各卓カード: 卓番号 / 状態（空席=border / 接客中=violet / 会計待ち=warning / 予約=info）/ 客名 / 指名キャスト名 / 滞在時間
   - 滞在時間が長い卓は warning ドットでアラート（例: 90 分超）
2. **右サイド: 待機キャスト**
   - ローテーション順のキャストリスト（アバター丸 + 源氏名 + 待機時間 / 接客中ステータス）
   - 「次の指名候補」を上に
3. **上部: サマリ**
   - 稼働卓数 / 空席数 / 接客中キャスト数（live data 風、cyan-mist）

## モックデータ例
- 卓 10（状態混在）、客名・指名キャストはダミー（「田中様 / 指名: 凛」等）
- キャスト 8（源氏名: 凛・葵・蘭・etc、待機/接客中）

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(seating): 席回しフロアマップ UI モック実装`。
