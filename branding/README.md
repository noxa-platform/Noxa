# Noxa ブランディング

## ブランド名
- 表記: `Noxa`（ノクサ）
- 由来: Latin "nox"（夜）+ "a"（造語）
- 商標: J-PlatPat 9/41/42 類 で ヒット 0 件（2026-05-13 確認）

## カラー

| 用途 | カラーコード | 用途 |
|---|---|---|
| Primary | `#6D4FE8` | ブランドメインカラー（紫） |
| Primary Deep | `#2A1B5E` | ロゴ深部 / ヘッダ |
| Background Night | `#0F0B2E` | 夜空背景 |
| Accent White | `#FFFFFF` | 文字 / ハイライト |
| Accent Soft | `#A89BFF` | サブテキスト / アイコン |

## ロゴファイル

- `logo-square-1024.png` … 1024x1024 メインロゴ（App Store 用、未生成）
- `logo-square-512.png` … 512x512
- `logo-square-192.png` … 192x192（Web マニフェスト）
- `logo-square-120.png` … 120x120（OAuth 同意画面）
- `logo-square-favicon-32.png` … 32x32 (favicon)
- `logo-horizontal.png` … 横長ロゴ（Web ヘッダ用）

※ 現在は YoruLog の暫定ロゴを使用中。Noxa 専用ロゴは Codex CLI で生成予定。

## デザイン方針

- **N** + **三日月** を組み合わせたマーク
- 紫黒系（夜のイメージ）
- ミニマル・フラット（Linear / Cursor 風）
- 120px でも判読可能な明確さ

## ロゴ生成プロンプト（Codex CLI image_gen 用）

```
Generate a minimalist app icon for "Noxa" — a night-economy SaaS platform.

Concept:
- Bold lowercase letter "n" or stylized capital "N" as the central mark
- Subtle crescent moon integrated into the negative space
- Deep purple gradient (#2A1B5E → #6D4FE8) on a darker night-blue background (#0F0B2E)
- Optional subtle starlight specks (3-5 tiny points, very faint)
- Rounded square canvas (iOS app icon style), 22% corner radius
- No text other than the mark itself
- Vector-clean, flat with a single soft inner shadow for depth

Output: 1024x1024 PNG, rounded square fills the entire canvas.

Style references: Linear app, Cursor app, Vercel — minimal modern SaaS branding.
```
