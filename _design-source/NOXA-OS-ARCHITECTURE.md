# NOXA — ナイトワーク OS Architecture

作成: 2026-05-30
ステータス: 構想 v2 ドラフト（ヒアリング後の整理）

---

## 1. ひとことで

**NOXA は「夜の街の OS」**。
個人キャスト・ホストもオーナーも、夜職に必要な業務を **1 アカウント・1 画面** から動かせるプラットフォーム。POS から名刺発注まで、ナイトワークの店舗運営に必要な全機能を束ねた **Operating System** として位置付ける。

---

## 2. 構造

```
┌──────────────────────────────────────────────────────┐
│  NOXA — ナイトワーク OS                                │
│  (Firebase: noxa-platform · Vercel · Next.js)        │
│                                                       │
│  ┌── MAIN MODULES (店舗運営の本体機能) ──────────┐   │
│  │   ① POS          ② 売上管理（旧 yorulog）       │   │
│  │   ③ 席回し       ④ 勤怠管理                    │   │
│  │   ⑤ 給与計算     ⑥ 初回案内                    │   │
│  │   ⑦ 送迎         ⑧ 在庫管理                    │   │
│  │   ⑨ オリシャン名刺発注                          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                       │
│  ┌── SUB MODULES (NOXA 上のアプリ的レイヤー) ─────┐   │
│  │   • 夜職専用紹介制コミュニティ (Closed SNS)     │   │
│  │   • のみシュギ (バー紹介 + 求人)               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                       │
│  共通基盤: Firebase Auth (SSO)、Firestore、Storage、 │
│            Stripe (課金共有)、Vercel (Web)、         │
│            Capacitor (Android)、SwiftUI (iOS 別リポ)│
└──────────────────────────────────────────────────────┘
```

---

## 3. メイン機能 9 個 — 詳細

| # | モジュール | 主ユーザー | 現状 | 実装位置 |
|---|---|---|---|---|
| ① | **POS（オーダーエントリー・決済機能なし）** | 店舗フロント・キャスト | 未実装 | yorulog `(app)/pos/` 予定 |
| ② | **売上管理** | 個人キャスト・ホスト・マネージャ | **実装済み（旧 yorulog）** | yorulog `(app)/{home, sales, daily-close, insights}/` |
| ③ | **席回し** | フロア責任者・店長 | 未実装 | yorulog `(app)/seating/` 予定 |
| ④ | **勤怠管理** | 店長・マネージャ | 未実装 | yorulog `(app)/attendance/` 予定 |
| ⑤ | **給与計算** | 店長・経理 | 未実装 | yorulog `(app)/payroll/` 予定 |
| ⑥ | **初回案内** | 店長・新人教育担当 | 未実装 | yorulog `(app)/first-visit/` 予定 |
| ⑦ | **送迎** | ドライバー・店長 | 未実装 | yorulog `(app)/transport/` 予定 |
| ⑧ | **在庫管理** | バーマネージャ・仕入担当 | 未実装 | yorulog `(app)/inventory/` 予定 |
| ⑨ | **オリシャン名刺発注** | キャスト・ホスト本人 | 未実装 | yorulog `(app)/business-card/` 予定 |

### 既存の他機能（メイン 9 個に含まれない補助）
- `customers` / `ranking` / `calendar` / `goals` / `team` / `unpaid` / `import` / `export` / `line-send` / `feedback` 等は **②売上管理の周辺ユーティリティ** として既存。
- AI 関連（`ai`、AI チャット、AI バースデーメッセージ）は ① + ② を横断する **AI コンシェルジュ** 機能群として将来的に独立カテゴリ化候補。

---

## 4. サブ機能 2 個

### A. 夜職専用紹介制コミュニティ（Closed SNS）
- **役割**: 夜職で働く人同士の交流、情報共有、相互サポート
- **アクセス制御**: 既存ユーザーからの招待制 / 在籍店舗確認による紹介制
- **現状**: 未実装。NOXA Community として近日公開と LP で予告中
- **実装位置候補**: NOXA リポ内 `src/app/community/`（独立サブドメイン化も検討）

### B. のみシュギ（バー紹介 + 求人）
- **役割**: バーディレクトリ、お客さん向けバー検索、求人マッチング、コラム
- **現状**: 既存 nomishugy リポで運用中（Marketplace / Directory パターン）
- **最終形態（決定済み）**: **C. ハイブリッド** — 既存 `nomishugy.vercel.app`（将来 `nomishugy.egshugy.com`）は独立ドメインで維持 + NOXA umbrella にも `/bars` で内蔵。SSO 連携で共通アカウント。
  - **理由**: 既存 SEO 資産は捨てない / 業界従事者には NOXA umbrella からの動線が必要 / コンシューマー（バー客）に「NOXA」は刺さらない
  - **実施タイミング**: **Phase v1.3 の業務モジュール実装と同時** — POS / 席回し / 勤怠などが揃って NOXA の価値が明確になるタイミングでブランド磨き直し
- **データ**: nomishugy が SSR で読む bars / timeline は、すでに **noxa-platform Firestore に統合済み**

---

## 5. データ統合の現状

```
Firebase (noxa-platform)
├── auth                     ← Auth UID = NOXA アカウント = 全モジュール共通
├── firestore
│   ├── bars                 ← nomishugy primary、yorulog 経由読み
│   ├── users                ← 共通
│   ├── sales                ← yorulog primary
│   ├── customers            ← yorulog
│   ├── workspaces           ← yorulog
│   ├── crm_*                ← yorulog 独自プレフィクス
│   ├── timelines            ← nomishugy
│   ├── jobs                 ← nomishugy
│   └── (将来) pos / seating / attendance / payroll / inventory / transport / business_card / community_*
└── storage                  ← 画像（バー写真、名刺デザイン、レシート等）
```

**ユーザーの訂正**: 旧 `minami-bar-guide` Firebase project からは移行完了。現在は **noxa-platform** のみが live DB。`legacy` キーは `.firebaserc` に残っているが読み取り用途なし。

---

## 6. リポジトリ → モジュール対応表

| リポジトリ | 役割（現状） | 役割（将来 NOXA 統合後） |
|---|---|---|
| **noxa-platform** | NOXA umbrella LP + Account hub | OS の **dashboard / shell**（9 メイン + 2 サブを束ねる） |
| **yorulog** | 売上管理 CRM（Web + Capacitor Android） | NOXA OS の **業務モジュール群**（② 売上 + ① POS + ③〜⑨ を新規実装） |
| **nomishugy** | バーポータル + マッチング + 求人 | NOXA OS の **サブ機能 B**（のみシュギ）として吸収 or サブドメイン継続 |
| **yorulog-ios** | iOS SwiftUI ネイティブ | NOXA OS の iOS 版。本セッション対象外 |

「最終 NOXA 統合」のロードマップは別途。当面は **既存 yorulog の `(app)/` に新モジュールのディレクトリだけ scaffold** して、NOXA umbrella の dashboard から各モジュールにリンクできるようにする。

---

## 7. ユーザー像（モジュール × 役割マトリクス）

| 役割 | 主に使うモジュール |
|---|---|
| **個人キャスト・ホスト** | ② 売上管理（自分の数字）、⑥ 初回案内（自分宛て）、⑨ 名刺発注、A コミュニティ |
| **フロア責任者・店長** | ① POS、③ 席回し、④ 勤怠、⑥ 初回案内、⑦ 送迎、⑧ 在庫 |
| **店舗オーナー・経営者** | ⑤ 給与計算、② 売上管理（全体集計）、⑧ 在庫、A コミュニティ |
| **ドライバー・補助スタッフ** | ⑦ 送迎、④ 勤怠 |
| **バー客（夜遊びユーザー）** | B のみシュギ（バー検索）、A コミュニティ |
| **求職キャスト** | B のみシュギ（求人）、② 売上管理（前職データ移行）|

→ **NOXA OS の dashboard は、ログインユーザーの役割に応じてメインカードの並びを変える** のが理想（role-based home）。

---

## 8. デザイン適用方針（v1.1 Tactile Glow を継承）

- 全モジュールで **NOXA brand zone（violet hierarchy + cyan-mist live data + status semantic）** を使用
- 各モジュール ID に **status badge**（実装済 / Beta / Coming soon / Idea）を表示
- 売上 / 在庫 / 給与 などの数値はすべて `SalesTrendChart` のような **NOXA SVG chart 系コンポーネント** で表現（依存ゼロ）
- POS / 席回し / 勤怠は **モバイル + タブレット最適化を最優先**（店舗オペレーション現場）
- 名刺発注 / 給与計算 は **デスクトップ最適化**（事務作業）

---

## 9. 実装フェーズ計画

### Phase v1.1（完了済み）
- NOXA design system v1.1
- 3 リポの token 統一（mirror layer 戦略）
- SalesTrendChart / RealTimeMetrics / TrustAndHostCTA を各リポに配置済み

### Phase v1.2（本セッションで進める）
- [ ] yorulog `(app)/` に 8 モジュールの **scaffold ディレクトリ**を作成（POS / seating / attendance / payroll / first-visit / transport / inventory / business-card）
- [ ] 各モジュールに `page.tsx` プレースホルダー（NOXA brand zone、「Coming Soon · Phase v1.3 予定」表示、関連既存機能へのリンク）
- [ ] NOXA umbrella `src/app/page.tsx` を **OS dashboard 風**に再設計：9 メイン + 2 サブの 11 カードグリッド、各カードに status badge とリンク先
- [ ] NOXA `community/page.tsx` scaffold（紹介制 SNS の announce ページ）
- [ ] SVG 図解 v2（本ドキュメントの図解版）

### Phase v1.3 以降（本セッション対象外、別タスク）
- [ ] role-based home（ログインユーザー役割でカード並び替え）
- [ ] POS / 席回し / 勤怠の本格実装
- [ ] 給与計算（Stripe Connect 検討）
- [ ] 在庫管理 / 名刺発注（外部 API 連携）
- [ ] NOXA 統合のための yorulog/nomishugy の最終的なルーティング戦略
  （独立サブドメインを保つか、NOXA umbrella 下の `/yorulog` `/bars` 等で吸収か）

---

## 10. 注意（修正待ち）

- ルート `egshugy-products/CLAUDE.md` の Firebase プロジェクト記述（`minami-bar-guide` 共有）は古い。本セッションで触らないが、別途更新が必要。**実装側はすでに `noxa-platform` に移行済み**。

---

## 11. 直近の議論で残る論点

ユーザー判断が必要な項目：
1. **メイン機能 9 個の実装優先順位**（Phase v1.3 → v1.4 → v1.5 の順を決める）
2. ~~nomishugy の最終形態~~ → **C. ハイブリッド確定**（独立ドメイン維持 + NOXA `/bars` 内蔵、Phase v1.3 で実施）
3. **コミュニティの招待モデル**（既存ユーザーから直接招待制？ 在籍店舗オーナーからの認可制？ ハイブリッド？）
4. ~~POS の決済 SDK 選定~~ → **決済機能は持たない方針で確定**（既存レジ運用と並走）
5. **オリシャン名刺発注の外部パートナー**（ラクスル？ プリントパック？ 自社印刷？）
6. **法人化後のドメイン戦略**（`*.egshugy.com` の各種 → `noxa.app`？ `noxa.work`？）

これらは別途ヒアリングして固めていく。
