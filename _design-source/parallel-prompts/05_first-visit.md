# ⑥ 初回案内 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/first-visit/page.tsx` を、初回案内（新人 OJT + 暗記カード）の**実画面 UI モック**に置き換える。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/first-visit/page.tsx`
- 必要なら `src/components/modules/first-visit/` に分割

## 画面仕様（ガワ）
1. **新人チェックリスト（メイン）**
   - カテゴリ別チェックリスト（持ち物 / 服装 / 接客 NG / 料金理解）
   - チェックボックス（useState で見た目トグルは可）+ 進捗バー（violet グラデ）
2. **暗記カード（タブ切替）**
   - タブ: 料金体系 / メニュー / ボトル紹介 / 指名トーク
   - 各タブにカード（表: 質問、裏: 答え 風、または項目リスト）
3. **OJT 進捗（店長ビュー）**
   - 新人 × 進捗% のカード一覧

## モックデータ例
- チェック項目 12 個（うち 8 完了で進捗 67%）
- 料金体系カード（セット料金・指名料・同伴料など）
- 新人 3 名の OJT 進捗

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(first-visit): 初回案内 UI モック実装`。
