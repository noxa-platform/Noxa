# NOXA OS モジュール ガワ実装 — 並列セッション投入ガイド

NOXA OS の業務モジュール UI を「ガワだけ」実装するための、別セッション投入用プロンプト群。
各プロンプトは独立して並列実行できる。パートナー選定・ドメイン・課金・実データ仕様は対象外。

## ファイル一覧

| # | ファイル | モジュール | 対象リポ | デプロイ |
|---|---|---|---|---|
| 共通 | `00_SHARED_CONTEXT.md` | （全タスク必読の前提） | — | — |
| 01 | `01_pos.md` | ① POS（決済なし） | yorulog | 手動 `vercel --prod` |
| 02 | `02_seating.md` | ③ 席回し | yorulog | 手動 |
| 03 | `03_attendance.md` | ④ 勤怠管理 | yorulog | 手動 |
| 04 | `04_payroll.md` | ⑤ 給与計算 | yorulog | 手動 |
| 05 | `05_first-visit.md` | ⑥ 初回案内 | yorulog | 手動 |
| 06 | `06_transport.md` | ⑦ 送迎 | yorulog | 手動 |
| 07 | `07_inventory.md` | ⑧ 在庫管理 | yorulog | 手動 |
| 08 | `08_business-card.md` | ⑨ オリシャン名刺発注 | yorulog | 手動 |
| 09 | `09_community.md` | A 紹介制コミュニティ | **NOXA** | **自動（push のみ）** |

※ ② 売上管理は既に実装済みのため対象外。

## 投げ方

各セッション（別タブ / 別ウィンドウ / goal コマンド等）で、次のように投げる：

```
C:\Users\wpuhs\egshugy-products\noxa\_design-source\parallel-prompts\01_pos.md
の内容に従って、最後まで自律的に実装してください。
```

または各 md の中身をそのままコピペ。各プロンプト冒頭で `00_SHARED_CONTEXT.md` を読む指示があるので、共通前提は自動で揃う。

## 並列実行の注意

### コンフリクトしない設計
- 01〜08 は同じ yorulog リポだが、**各自の `(app)/<module>/page.tsx` と `components/modules/<module>/` のみ**を触るので、ファイル競合しない
- ただし **同時に `git push` / `vercel --prod` が走るとデプロイが上書き合う**可能性がある

### 推奨運用（2 パターン）

**パターン A: 完全並列（速い、デプロイは最後にまとめて）**
- 各セッションには「実装 + commit + push まで」をやらせる
- `vercel --prod --yes` の手動デプロイは**最後に 1 回だけ**自分（親セッション）でまとめて実行
- → 各プロンプトの §7 の手順 6（vercel）を「やらない」と上書き指示すればよい

**パターン B: 逐次デプロイ（各自完結、衝突回避）**
- yorulog 系（01〜08）は 2〜3 個ずつのバッチで回す
- 各バッチ完了後にデプロイ、次のバッチへ
- 09（NOXA / 自動デプロイ）は yorulog と別リポなので、いつ走らせても干渉しない

### 最小コンフリクト構成
- 09（community / NOXA）は**いつでも独立に**走らせてよい（別リポ・自動デプロイ）
- 01〜08（yorulog）は **commit は各自 OK**、push/deploy のタイミングだけ調整

## 完了後

全モジュールのガワが揃ったら、親セッションで：
1. NOXA OS dashboard（`noxa/src/app/page.tsx`）の各カード status を `planned` → `beta` 等に更新
2. SVG 図解 v3（実装済みモジュールを反映）
3. 全モジュールの 375px / 1280px スクショを集めて一覧化

を依頼するとよい。
