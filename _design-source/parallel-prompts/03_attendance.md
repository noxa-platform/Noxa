# ④ 勤怠管理 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/attendance/page.tsx` を、勤怠管理（打刻 + シフト + 集計）の**実画面 UI モック**に置き換える。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/attendance/page.tsx`
- 必要なら `src/components/modules/attendance/` に分割

## 画面仕様（ガワ）
1. **打刻ヒーロー（上部）**
   - 大きな出勤/退勤トグルボタン（noxa-btn-primary、glow）
   - 現在時刻の大型表示（Cormorant、tabular-nums）。※時刻はモック固定値でよい（`new Date()` は使わず "23:14" 等のダミー）
   - 今日の状態（未出勤 / 出勤中 since 21:00 等）
2. **月間シフトカレンダー（中）**
   - 7 列カレンダーグリッド、出勤日に violet ドット、本日ハイライト
3. **今月サマリ（下）**
   - 出勤日数 / 総勤務時間 / 遅刻回数 / 欠勤回数（カード、status 色）
4. **スタッフ一覧（店長ビュー、最下部）**
   - スタッフ × 本日の出勤状況テーブル（出勤中 / 未出勤 / 遅刻 の status バッジ）

## モックデータ例
- 月間出勤日 18 日、遅刻 1、欠勤 0
- スタッフ 6 名（凛・葵・蘭・店長 etc、状態混在）

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(attendance): 勤怠管理 UI モック実装`。
