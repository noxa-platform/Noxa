# 共通コンテキスト — NOXA OS モジュール ガワ実装（別セッション必読）

> このファイルは、NOXA OS の業務モジュール UI を「ガワだけ」実装する各セッションが
> **最初に必ず読む**共通前提。個別タスクは `01_*.md`〜`09_*.md` を参照。

---

## 1. NOXA とは

**NOXA = 夜の街の OS（ナイトワーク総合プラットフォーム）**。
個人キャスト・ホストもオーナーも、夜職に必要な業務を 1 アカウント・1 画面から動かす。

### メイン業務モジュール 9 個
① POS（決済機能なし、オーダー/伝票のみ）／② 売上管理（旧 yorulog、実装済み）／③ 席回し／
④ 勤怠管理／⑤ 給与計算／⑥ 初回案内／⑦ 送迎／⑧ 在庫管理／⑨ オリシャン名刺発注

### サブ機能 2 個
A. 夜職専用紹介制コミュニティ（Closed SNS、近日公開）／B. のみシュギ（バー紹介+求人、既存 nomishugy）

---

## 2. リポ構成と建付け（重要・2026-06 確定）

### 配信チャネルの建付け
```
Web 版          = NOXA に完全統合（全機能 = 個人 + 店舗運営すべて）。ブランド NOXA
                  ↳ 実体は yorulog リポ（完成したアプリシェル (app)/ があるため）
よるログアプリ   = 売上管理専門（個人キャスト/ホスト向け、② 売上管理のみ）
  ├ iOS        = 別リポ yorulog-ios（SwiftUI）。触らない
  └ Android    = WebView だと NOXA フルが見えてしまう → ネイティブ作り直し検討中（保留）
```

**要点**: Web ブラウザでアクセスすると **NOXA OS（全機能）**。だから店舗運営モジュール（POS 等）を
yorulog リポに置いて**正しい**（Web では NOXA として出る）。「よるログ」は売上特化のネイティブアプリ
専用サブブランドで、別チャネルの話。**ガワ実装では「Web = NOXA」だけ意識すればよい**（アプリ出し分けは別途）。

### リポ
| リポ | パス | デプロイ |
|---|---|---|
| **NOXA** (`noxa-platform/Noxa`) | `C:\Users\wpuhs\egshugy-products\noxa` | Vercel 自動（master push で反映） |
| **yorulog**（= NOXA Web 本体） | `C:\Users\wpuhs\egshugy-products\yorulog` | **自動デプロイ停止中 → `vercel --prod --yes` 手動** |
| **nomishugy** | `C:\Users\wpuhs\egshugy-products\nomishugy` | 同上（手動） |
| iOS (`yorulog-ios`) | 別リポ | **触らない（別セッション運用）** |

### モジュールの置き場所
- 業務モジュール ①③〜⑨ は **yorulog リポ（= NOXA Web 本体）の `src/app/(app)/<module>/page.tsx`** に実装。現状は `ComingSoonModule` スタブ（これを実画面モックに置き換える）。
  - **これは「NOXA Web に出る店舗運営機能」**。ブランドは NOXA。yorulog という名前はリポの技術名として残るだけ。
- コミュニティ（A）は **NOXA リポの `src/app/community/`** に実装。
- ブランド表記は **NOXA**（"よるログ" 表記はネイティブアプリ専用なので、Web のガワには出さない）。

---

## 3. デザインシステム v1.1「Tactile Glow」

3 リポとも `src/app/globals.css` に NOXA token が**既に入っている**。**globals.css は変更しない**。
以下を CSS 変数 / utility class として使う。

### カラートークン（CSS 変数）
```
--noxa-bg-base:      #07050D   /* 背景。pure #000 は禁止（OLED 残像）*/
--noxa-bg-elevated:  #110A1C
--noxa-surface-card: #1A1228
--noxa-surface-muted:#221830
--noxa-surface-hover:#2A2038
--noxa-accent-primary:     #8B5CF6   /* violet メイン */
--noxa-accent-primary-ink: #B89CFB   /* lavender、見出し・アクセント */
--noxa-accent-primary-neon:#C084FC   /* glow 専用 */
--noxa-accent-destructive: #C4384A   /* wine */
--noxa-text-primary: #F5F1FA
--noxa-text-muted:   #A89FBE
--noxa-text-faint:   #6E6585   /* 本文 13px 未満には使わない */
--noxa-border:        #2A2038
--noxa-border-strong: #3A2D4A
--noxa-divider:       rgba(184,156,251,0.20)
/* status semantic */
--noxa-status-success: #7BE8A1
--noxa-status-warning: #F5D472
--noxa-status-error:   #C4384A
--noxa-status-info:    #67E8F9   /* cyan-mist、live data 専用 */
--noxa-status-soon:    #A89FBE
/* glow */
--noxa-glow-soft:   0 0 16px rgba(139,92,246,0.32)
--noxa-glow-strong: 0 0 24px rgba(192,132,252,0.45), 0 0 60px rgba(139,92,246,0.32)
--noxa-glow-ring:   0 0 0 1px rgba(184,156,251,0.40), 0 0 24px rgba(139,92,246,0.32)
/* motion */
--noxa-ease-natural: cubic-bezier(0.16,1,0.3,1)
--noxa-duration-fast: 150ms
```

### フォント
```
--noxa-font-display-en: 'Cormorant Garamond','Shippori Mincho B1',serif  /* 見出し・数字の大型表示 */
--noxa-font-display-jp: 'Shippori Mincho B1','Cormorant Garamond',serif
--noxa-font-sans-jp:    'Noto Sans JP','Geist',system-ui,sans-serif       /* 本文 */
--noxa-font-mono:       'JetBrains Mono',ui-monospace,monospace           /* ラベル・eyebrow・数値 */
```

### utility class（globals.css に定義済み・そのまま使う）
- `.noxa-zone` — NOXA brand zone のルート（背景・文字色・JP フォント）。各モジュールのトップに付ける
- `.noxa-eyebrow` — mono 11px / 0.18em tracking / uppercase / lavender。セクションの上の小見出し
- `.noxa-display` `.noxa-display-jp` — Cormorant/Shippori の大型ディスプレイ
- `.noxa-logo` — N<em>O</em>XA ワードマーク（O が lavender）
- `.noxa-btn` `.noxa-btn-primary` `.noxa-btn-secondary` `.noxa-btn-ghost` `.noxa-btn-destructive` — ボタン（44px touch target 込み）
- `.noxa-input` — 入力（16px、focus glow 込み）
- `.noxa-card` — カード
- `.noxa-status` + `.noxa-status-success/warning/error/info/soon` — ドット+テキストのステータスバッジ
- `.noxa-tex` — subtle noise texture overlay

### 参考にする既存コンポーネント（コピペ元として最適）
- `yorulog/src/components/noxa/ComingSoonModule.tsx` — brand zone のレイアウト・breadcrumb・status banner の作り方
- `yorulog/src/components/dashboard/SalesTrendChart.tsx` — 純 SVG チャート（依存ゼロ）、hover tooltip、A11y データテーブル fallback、cyan-mist live glow
- `yorulog/src/components/lp/RealTimeMetrics.tsx` — live metrics カードの作り方
- `noxa/src/app/page.tsx` — OS dashboard のカードグリッド・status badge

---

## 4.「ガワだけ」の定義（厳守）

- **モックデータで画面を組む**。Firestore / API / service 層には一切繋がない
- ビジネスロジック（計算・保存・送信）は実装しない。ボタンは見た目だけ（onClick は no-op か console.log）
- モックデータはファイル上部の `const MOCK_*` で定義
- **「これは UI モックです」と分かる程度のリアルさ**（実データ風のサンプル値を入れる）
- 状態（タブ切替・選択ハイライト等の UI 内部 state）は実装してよい（useState）。永続化はしない

## 5. 品質基準

- **モバイルファースト**：375px で破綻しない。`clamp()` / `grid auto-fit minmax()` でレスポンシブ
- touch target 44px 以上、`prefers-reduced-motion` 配慮（globals.css のガードが効くので追加 animation は控えめに）
- `pure #000000` 禁止（bg-base `#07050D` を使う）
- アクセシビリティ：見出し階層、aria-label、role。数値は `font-variant-numeric: tabular-nums`
- glow は CTA / focus / live data 限定（continuous animation は使わない）

## 6. 禁止事項（厳守）

- **他モジュール・他ファイルに触らない**（`globals.css` / `layout.tsx` / 他の `(app)/*/` / 既存 service・store 含む）
- 自分の担当 `page.tsx` と、必要なら同モジュール用の **新規コンポーネントファイル**（`src/components/modules/<module>/` 等）のみ作成・編集
- Firestore 実連携・新規 npm 依存の追加をしない（チャートが要るなら SalesTrendChart 同様 純 SVG で）
- iOS リポ（yorulog-ios）に触らない

## 7. 完遂手順（goal — 最後まで自律実行）

各タスクは以下を**止まらず最後まで**実行する：

1. 担当 `page.tsx`（と必要なら専用コンポーネント）を実装
2. `cd <リポ> && npx tsc --noEmit` で **型エラー 0** を確認（エラーが出たら直す）
3. `npm run build` が通ることを確認（重い場合は型チェックのみでも可、ただしビルドエラーは潰す）
4. `git add <担当ファイルのみ>` → `git commit`（`feat(<module>): <日本語説明>` 形式。コミット末尾に `Co-Authored-By: Claude <noreply@anthropic.com>`）
5. `git push origin master`
6. **yorulog/nomishugy は自動デプロイが無いので** `vercel --prod --yes` で手動デプロイ（**NOXA は push のみで自動デプロイ、vercel コマンド不要**）
7. playwright（または `npm run dev` + ブラウザ）で実画面を 375px / 1280px で確認、スクショ
8. 完了サマリ（作ったファイル / 画面の要素 / デプロイ URL / スクショ）を報告

> 「goal コマンドで最後まで」= 上記 1〜8 を人間の確認待ちで止めず、自律的に完遂する。
> 途中でエラーや判断が必要になったら、**ガワ実装に必要な最小限の仮定を置いて進める**
> （パートナー選定・ドメイン・課金・実データ仕様などの事業判断は不要、ダミーでよい）。
