# ⑨ オリシャン名刺発注 — UI ガワ実装

## 必読
まず `C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\00_SHARED_CONTEXT.md` を読め。

## ゴール
yorulog の `src/app/(app)/business-card/page.tsx` を、オリシャン名刺発注（テンプレ選択 + プレビュー + 注文フォーム）の**実画面 UI モック**に置き換える。
**印刷パートナーの選定・実発注は対象外**。ガワだけ。ロジックなし、モックデータのみ。

## 対象
- リポ: `C:\Users\wpuhs\egshugy-products\yorulog`
- 編集: `src/app/(app)/business-card/page.tsx`
- 必要なら `src/components/modules/business-card/` に分割

## 画面仕様（ガワ）
1. **テンプレート選択（上）**
   - 名刺デザインのプレビューカードをグリッド表示（3〜5 種）。CSS だけで「名刺っぽい」見た目を作る（violet / wine / gold 系の配色違い）
   - 選択中をハイライト（glow-ring）
2. **エディタプレビュー（メイン）**
   - 名刺の実寸風プレビュー（源氏名・所属店・連絡先・写真プレースホルダの□）
   - 横の入力欄（源氏名 / 店名 / SNS / キャッチコピー）— noxa-input、入力は useState で反映（見た目のみ）
3. **注文フォーム（下 or 右）**
   - 部数セレクト（100/300/500 枚）/ 用紙 / 加工（マット・光沢・箔押し）
   - 注文サマリ（小計・送料・合計、tabular-nums）
   - 「注文する」ボタン（noxa-btn-primary、no-op）
   - 「前回デザインで再注文」ボタン

## モックデータ例
- テンプレ 4 種、名刺の初期値（源氏名「凛」/ 店名「Club NOXA」/ ダミー連絡先）
- 部数 300 枚で小計 ¥4,800 等

## 完遂（goal）
00 の §7 に従い自律実行。commit `feat(business-card): オリシャン名刺発注 UI モック実装`。
