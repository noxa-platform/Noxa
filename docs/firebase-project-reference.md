# Firebase プロジェクト参照の食い違い調査（Day1・調査のみ）

作成: 2026-07-02（grind Day1）。**この日は変更せず調査のみ**。統一は Day6 で実施（PLAN 準拠）。

## 結論（正）
**正しい Firebase プロジェクトは `noxa-platform`。** `minami-bar-guide` は旧プロジェクトで、`.firebaserc` に `legacy` エイリアスとして残るのみ（読み書きなし）。

根拠:
- `.firebaserc`: `default = noxa-platform` / `legacy = minami-bar-guide`。
- `src/lib/firebase/config.ts:5`: 「Noxa は yorulog / nomishugy と同じ Firebase プロジェクト (noxa-platform) を共有」。
- コード内 `noxa-platform` 参照 14 件（Functions URL の既定、Firestore REST、Auth ドメイン等）。

## `minami-bar-guide` 残存箇所（3件）
| 箇所 | 種別 | 対応（Day6） |
|---|---|---|
| `src/app/account/delete/page.tsx:27` | **機能バグ級**: 退会処理の Functions URL 既定が `https://asia-northeast1-minami-bar-guide.cloudfunctions.net`。他ファイル（`lib/auth/line.ts`・`merge.ts`・`store-login/page.tsx`）は `noxa-platform` 既定なのにここだけ旧プロジェクト。`NEXT_PUBLIC_NOXA_FUNCTIONS_URL` 未設定時に旧プロジェクトを叩き退会が失敗しうる。 | 既定を `https://asia-northeast1-noxa-platform.cloudfunctions.net` に統一 |
| `README.md:38` | ドキュメント: 「`minami-bar-guide` プロジェクトを共有」は古い記述。 | `noxa-platform` に更新（README 全体を実態化） |
| `.firebaserc:4` `legacy` | 意図的な履歴エイリアス（CLAUDE.md でも legacy として残す方針）。 | **変更不要**（残す） |

## Functions URL 既定の不整合（付随発見）
`NEXT_PUBLIC_NOXA_FUNCTIONS_URL` 未設定時の**ハードコード既定が 2 系統**混在:
- `noxa-platform`: `lib/auth/line.ts:14` / `lib/auth/merge.ts:14` / `lib/auth/index.ts:231` / `store-login/page.tsx:9`
- `minami-bar-guide`: `account/delete/page.tsx:27`（← 要修正）

Day6 で `noxa-platform` に一本化し、可能なら定数へ集約（DRY）。

## 注意
Firebase は yorulog / nomishugy と共有。ルール等の共有 doc 変更は影響範囲を確認のうえ、本番反映は人間承認後（この grind では反映しない）。
