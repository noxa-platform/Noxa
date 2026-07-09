# NOXAページ Lane A（公開範囲・privacy基盤）Implementation Plan

> **For agentic workers:** このプランは Lane A（backend/privacy基盤）。Lane B（ブロック描画）・Lane C（編集UI）は別プラン。Steps はチェックボックス（`- [ ]`）で進捗管理。

**Goal:** 公開プロフィール `profile_pages/{handle}` に3値の公開範囲（public/unlisted/private）を導入し、退会時の公開ページ残存（privacyリーク）と非公開docの直読み漏れという既存の本番バグを修正する。

**Architecture:** 既存 `profile_pages/{handle}` 単一doc（`src/lib/handle.ts`）を拡張。`visibility` フィールドを正本にし、Firestoreルールでread/takedownを担保。退会APIに `profile_pages` 削除を追加。非公開/限定公開ページに noindex。Lane A は需要検証と独立した「今直すべき本番privacyバグ＋公開範囲の土台」で、単体で出荷可能。

**Tech Stack:** Next.js / TypeScript / Firebase Firestore（Admin SDK + client SDK）/ firestore.rules / Vitest + @firebase/rules-unit-testing（最小テスト・新規導入）。

**重要な前提:** NOXAは現状テスト基盤ゼロ。本プランは privacy/セキュリティの肝（ルール）と純関数のみテストを入れ、UIは手動QA。テスト実行はFirestoreエミュレータ必須。

---

## 公開モデル定義（実装の正本）

| visibility | 直URL/API read | 検索(noindex) | NOXA一覧 | OG画像 | 本人 | admin |
|---|---|---|---|---|---|---|
| `public`   | 誰でも可 | index | 載る | 出す | 可 | 可 |
| `unlisted` | URL知る人は可（軽いlink-only） | **noindex** | **載せない** | 出す | 可 | 可 |
| `private`  | **他者不可** | noindex | 載せない | **出さない** | 可 | 可 |

旧 `published` からの移行: `published==true → 'public'`、`false → 'private'`。移行前の `visibility` 無しdocは「`published==true` なら public 扱い」でフォールバック（既存ページを壊さない）。

---

## File Structure

- `src/lib/handle.ts` — `ProfilePage` 型に `visibility` 追加、`claimHandle` の初期値、`VISIBILITY` 定数。
- `firestore.rules` — `profile_pages` の read/update/delete をvisibility対応＋admin takedown。
- `src/app/api/account/delete/route.ts` — `profile_pages/{handle}` 削除を追加（F1）。
- `src/app/u/[handle]/page.tsx` — `generateMetadata` で非public時 noindex。
- `src/app/u/[handle]/opengraph-image.tsx` — private時はOGを出さない。
- `scripts/migrate-profile-visibility.mjs`（新規）— 既存doc移行スクリプト。
- テスト新規: `vitest.config.ts`、`test/rules/profile_pages.rules.test.ts`、`test/lib/handle.test.ts`。

---

### Task 0: 最小テスト基盤（Vitest + rules-unit-testing）

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`（scripts/devDependencies）

- [ ] **Step 1: テスト依存を入れる**

```bash
cd /home/wpuhs/dev/noxa-platform/noxa
npm i -D vitest @firebase/rules-unit-testing
```

- [ ] **Step 2: vitest.config.ts を作成**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 3: package.json に test スクリプト追加**

`scripts` に以下を追加（既存の dev/build/start/lint は残す）:

```json
"test": "vitest run",
"test:rules": "firebase emulators:exec --only firestore --project noxa-platform \"vitest run test/rules\""
```

- [ ] **Step 4: スモーク確認**

Run: `npx vitest run --reporter=dot`
Expected: テスト0件で正常終了（"No test files found" でも可。設定が壊れていないこと）

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(noxa): 最小テスト基盤(Vitest + rules-unit-testing)を導入"
```

---

### Task 1: ProfilePage 型に visibility を追加（純関数テスト）

**Files:**
- Modify: `src/lib/handle.ts`（型 `ProfilePage` line 86-97、`claimHandle` line 67-79）
- Test: `test/lib/handle.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/lib/handle.test.ts
import { describe, it, expect } from 'vitest';
import { resolveVisibility, VISIBILITY } from '../../src/lib/handle';

describe('resolveVisibility（旧published互換）', () => {
  it('visibility があればそれを返す', () => {
    expect(resolveVisibility({ visibility: 'unlisted', published: false })).toBe('unlisted');
  });
  it('visibility 無し & published=true は public', () => {
    expect(resolveVisibility({ published: true })).toBe('public');
  });
  it('visibility 無し & published=false は private', () => {
    expect(resolveVisibility({ published: false })).toBe('private');
  });
  it('VISIBILITY は3値', () => {
    expect(VISIBILITY).toEqual(['public', 'unlisted', 'private']);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run test/lib/handle.test.ts`
Expected: FAIL（`resolveVisibility` / `VISIBILITY` が未定義）

- [ ] **Step 3: 最小実装**

`src/lib/handle.ts` の `ProfilePage` 型（line 86-97）に `visibility` を追加し、互換ヘルパーを追加する。

型に追記:
```ts
export const VISIBILITY = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export type ProfilePage = {
  handle: string;
  type: ProfileType;
  ownerUid: string;
  refId: string;
  displayName: string;
  avatar: string;
  bio: string;
  sns: SnsLink[];
  published: boolean;        // 後方互換のため残す（visibility が正本）
  visibility?: Visibility;   // 正本（未設定の既存docは published から導出）
  shopHandle?: string;
};

/** 旧 published との後方互換で visibility を解決する */
export function resolveVisibility(p: { visibility?: string; published?: boolean }): Visibility {
  if (p.visibility === 'public' || p.visibility === 'unlisted' || p.visibility === 'private') {
    return p.visibility;
  }
  return p.published ? 'public' : 'private';
}
```

`claimHandle`（line 67-79）の `tx.set(pageRef, {...})` に `visibility: 'private'` を追加（新規は非公開で作る。`published: false` と整合）。

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run test/lib/handle.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/handle.ts test/lib/handle.test.ts
git commit -m "feat(noxa): profile_pages に visibility(3値)を導入・published後方互換ヘルパー"
```

---

### Task 2: firestore.rules — visibility read制御 + admin takedown（ルールテスト）

**Files:**
- Modify: `firestore.rules`（`profile_pages` ブロック line 761-765）
- Test: `test/rules/profile_pages.rules.test.ts`

- [ ] **Step 1: 失敗するルールテストを書く**

```ts
// test/rules/profile_pages.rules.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const OWNER = 'owner_uid';
const OTHER = 'other_uid';
const ADMIN = 'admin_uid';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'noxa-platform',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  // 事前データ（ルール無視で投入）
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'account_users/admin_uid'), { platformRole: 'admin' });
    await setDoc(doc(db, 'profile_pages/pub'),  { ownerUid: OWNER, visibility: 'public' });
    await setDoc(doc(db, 'profile_pages/unl'),  { ownerUid: OWNER, visibility: 'unlisted' });
    await setDoc(doc(db, 'profile_pages/priv'), { ownerUid: OWNER, visibility: 'private' });
    await setDoc(doc(db, 'profile_pages/legacy'), { ownerUid: OWNER, published: true }); // visibility無し
  });
});
afterAll(async () => { await env.cleanup(); });

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('profile_pages read', () => {
  it('public は匿名でも読める', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/pub'))); });
  it('unlisted は匿名でも読める(URL知る人)', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/unl'))); });
  it('private は他者は読めない', async () => { await assertFails(getDoc(doc(as(OTHER), 'profile_pages/priv'))); });
  it('private は本人は読める', async () => { await assertSucceeds(getDoc(doc(as(OWNER), 'profile_pages/priv'))); });
  it('private は admin は読める', async () => { await assertSucceeds(getDoc(doc(as(ADMIN), 'profile_pages/priv'))); });
  it('legacy(visibility無し,published=true) は読める', async () => { await assertSucceeds(getDoc(doc(anon(), 'profile_pages/legacy'))); });
});

describe('profile_pages update/delete', () => {
  it('他者は更新できない', async () => { await assertFails(setDoc(doc(as(OTHER), 'profile_pages/pub'), { bio: 'x' }, { merge: true })); });
  it('本人は更新できる', async () => { await assertSucceeds(setDoc(doc(as(OWNER), 'profile_pages/pub'), { bio: 'x' }, { merge: true })); });
  it('admin は更新できる(takedown)', async () => { await assertSucceeds(setDoc(doc(as(ADMIN), 'profile_pages/pub'), { visibility: 'private' }, { merge: true })); });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm run test:rules`
Expected: FAIL（現行ルール `read: if true` だと private が他者read成功してしまい "private は他者は読めない" が落ちる。admin update も落ちる）

- [ ] **Step 3: ルールを修正**

`firestore.rules` の `profile_pages` ブロック（line 761-765）を置換:

```
    match /profile_pages/{handle} {
      // 公開範囲: public/unlisted は誰でも read 可（unlisted は noindex で検索除外＝軽いlink-only）。
      // private は本人/admin のみ。visibility 無しの既存doc は published==true を public 扱いでフォールバック。
      allow read: if resource.data.visibility == 'public'
        || resource.data.visibility == 'unlisted'
        || (!('visibility' in resource.data) && resource.data.published == true)
        || (isAuth() && resource.data.ownerUid == request.auth.uid)
        || isAdmin();
      allow create: if isAuth() && request.resource.data.ownerUid == request.auth.uid;
      // 本人 or admin（admin は通報対応の takedown 用）
      allow update, delete: if isAuth()
        && (resource.data.ownerUid == request.auth.uid || isAdmin());
    }
```

- [ ] **Step 4: テスト通過を確認**

Run: `npm run test:rules`
Expected: PASS（read 6件・update/delete 3件）

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/rules/profile_pages.rules.test.ts
git commit -m "fix(noxa): profile_pages のread穴を塞ぎvisibility制御+admin takedown(F2/F4)"
```

- [ ] **Step 6: ルールを本番反映**

```bash
firebase deploy --only firestore:rules --project noxa-platform
```
Expected: "Deploy complete!"（既存ブロックは破壊せず profile_pages のみ変更）

---

### Task 3: 既存doc移行スクリプト（visibility 付与）

**Files:**
- Create: `scripts/migrate-profile-visibility.mjs`

- [ ] **Step 1: 移行スクリプトを書く**

```js
// scripts/migrate-profile-visibility.mjs
// 既存 profile_pages に visibility が無いdocへ、published から導出した値を付与する。
// 実行: node scripts/migrate-profile-visibility.mjs
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'noxa-platform' });
const db = getFirestore();

const snap = await db.collection('profile_pages').get();
let updated = 0, skipped = 0;
const batch = db.batch();
for (const d of snap.docs) {
  const data = d.data();
  if (data.visibility) { skipped++; continue; }
  const visibility = data.published ? 'public' : 'private';
  batch.update(d.ref, { visibility });
  updated++;
}
if (updated > 0) await batch.commit();
console.log(`profile_pages 移行完了: 更新 ${updated} / スキップ(既にvisibilityあり) ${skipped} / 全 ${snap.size}`);
process.exit(0);
```

- [ ] **Step 2: ドライ実行（本番DB・冪等）**

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json \
  node scripts/migrate-profile-visibility.mjs
```
Expected: `profile_pages 移行完了: 更新 N / スキップ M / 全 (N+M)`。再実行で `更新 0`（冪等）。

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-profile-visibility.mjs
git commit -m "chore(noxa): profile_pages の visibility 移行スクリプト(published→visibility)"
```

---

### Task 4: 退会で profile_pages を削除（F1・回帰修正）

**Files:**
- Modify: `src/app/api/account/delete/route.ts`（line 14-16 付近）

- [ ] **Step 1: 修正を入れる**

`route.ts` の「1. Firestore データ削除」冒頭（line 16 `account_users` 削除の**直前**）に、handle を読んで profile_pages を消す処理を追加:

```ts
    // profile_pages/{handle}（退会後も公開ページが残るのを防ぐ・privacy）
    const userSnap = await db.doc(`account_users/${uid}`).get();
    const handle = userSnap.exists ? userSnap.data()?.handle : undefined;
    if (handle) {
      await db.doc(`profile_pages/${handle}`).delete();
    }

    // account_users/{uid}
    await db.doc(`account_users/${uid}`).delete();
```

（注：`account_users` 削除は handle 読み取りの**後**に行う。順序を入れ替えないこと。）

- [ ] **Step 2: 手動検証（エミュレータ or 検証用使い捨てユーザー）**

検証手順（使い捨てユーザーでHTTP）:
1. 使い捨てユーザーでログイン→onboardingでhandle取得→`/u/<handle>` が表示されることを確認。
2. `POST /api/account/delete` を当該ユーザーのIDトークンで実行。
3. `/u/<handle>` が「見つかりませんでした」(404相当)になることを確認。
4. Firestore で `profile_pages/<handle>` が消えていることを確認。

Expected: 退会後 `/u/<handle>` が残存しない。

- [ ] **Step 3: Commit**

```bash
git add src/app/api/account/delete/route.ts
git commit -m "fix(noxa): 退会時に profile_pages/{handle} を削除(公開ページ残存=privacyリーク修正・F1)"
```

---

### Task 5: 非public ページに noindex + OG ガード

**Files:**
- Modify: `src/app/u/[handle]/page.tsx`（`generateMetadata` 追加）
- Modify: `src/app/u/[handle]/opengraph-image.tsx`（private時はOGを出さない）
- Modify: `src/components/profile/PublicProfile.tsx`（line 29 の表示分岐を visibility 基準に）

- [ ] **Step 1: generateMetadata で noindex（page.tsx）**

`src/app/u/[handle]/page.tsx` はクライアントコンポーネント（`'use client'`）なので、`generateMetadata` を置けるよう **page.tsx をサーバコンポーネント化し、表示部を子クライアントに委譲**する。最小改修:

```tsx
// src/app/u/[handle]/page.tsx （サーバコンポーネント化）
import type { Metadata } from 'next';
import { getAdminDb } from '@/app/api/lib/firebase-admin';
import { PublicProfile } from '@/components/profile/PublicProfile';

async function readVisibility(handle: string): Promise<string> {
  try {
    const snap = await getAdminDb().doc(`profile_pages/${handle.toLowerCase()}`).get();
    if (!snap.exists) return 'missing';
    const d = snap.data() || {};
    return d.visibility || (d.published ? 'public' : 'private');
  } catch { return 'missing'; }
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const vis = await readVisibility(handle);
  // public のみ index 許可。unlisted/private/missing は noindex。
  if (vis !== 'public') return { robots: { index: false, follow: false } };
  return {};
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PublicProfile handle={handle} expectType="user" />;
}
```

- [ ] **Step 2: PublicProfile の表示分岐を visibility 基準に（PublicProfile.tsx）**

`PublicProfile.tsx` line 29 の `if (!page.published)` を visibility 解決に置換:

```tsx
import { getProfilePage, resolveVisibility, type ProfilePage, type ProfileType } from '@/lib/handle';
// ...
  // private は本人以外に出さない（client側の二重防御。read自体はルールで担保済み）
  const vis = resolveVisibility(page);
  if (vis === 'private') return <Centered>このプロフィールは非公開です。</Centered>;
```
（unlisted は表示する＝URL知る人向け。public/unlisted はそのまま描画。）

- [ ] **Step 3: OG画像のガード（opengraph-image.tsx）**

`opengraph-image.tsx` で profile を読む箇所の直後に、private なら中身を出さない分岐を追加（汎用OGにフォールバック）:

```tsx
// profile 取得後
const vis = data?.visibility || (data?.published ? 'public' : 'private');
if (!data || vis === 'private') {
  // 非公開はプロフィール内容を含まない汎用OGを返す
  return new ImageResponse(<div style={{ /* NOXA汎用ロゴOG */ }}>NOXA</div>, size);
}
```

- [ ] **Step 4: 手動QA**

1. `/u/<public handle>` のHTML `<meta name="robots">` が無い（index許可）。
2. `/u/<unlisted handle>` と存在しないhandleで `robots: noindex` が出る。
3. private ページが他者ブラウザ（未ログイン）で「非公開です」表示、かつOGに本人情報が出ない。

Expected: 上記すべて一致。

- [ ] **Step 5: Commit**

```bash
git add src/app/u/[handle]/page.tsx src/components/profile/PublicProfile.tsx src/app/u/[handle]/opengraph-image.tsx
git commit -m "feat(noxa): 非public プロフィールに noindex + OGガード(F5)"
```

---

### Task 6: Lane A の最終確認とデプロイ

- [ ] **Step 1: 全テスト**

Run: `npx vitest run` および `npm run test:rules`
Expected: 全PASS（handle 4件 + rules 9件）

- [ ] **Step 2: ビルド**

Run: `npm run build`
Expected: EXIT 0（WSLで lightningcss エラー時は `npm install --no-save lightningcss-linux-x64-gnu@<version>` で補完。[[wsl-build-deploy-workarounds]] 参照）

- [ ] **Step 3: 本番反映**

- ルール: Task 2 Step 6 で反映済み。
- 移行: Task 3 Step 2 で実行済み。
- Web: `git push origin <SHA>:refs/heads/main`（NOXAはVercel自動）。※feat/community-board からの取り込み方針は実行時に確認。

---

## Self-Review

- **Spec coverage:** F1(Task4)/F2(Task2)/F4(Task2)/F5(Task5)/visibility 3値(Task1)/移行(Task3)/テスト基盤(Task0) — Eng Review の Lane A 全項目をカバー。
- **Placeholder scan:** 各stepに実コード・実コマンドあり。TODO無し。
- **Type consistency:** `Visibility`/`resolveVisibility`/`VISIBILITY` を Task1 で定義し Task5 で使用、整合。

## NOT in scope（このLane Aでは扱わない）
- blocks スキーマ・描画（Lane B）、編集UI（Lane C）、画像/Storage（Phase2）、トークン厳密link-only（Phase2）、自動画像モデレーション、課金ゲート、handleキー→uidキー作り替え（TODO）。

## Failure modes
- F1未修正なら退会後ページ残存（サイレント）→ Task4 + 手動検証で担保。
- F2未修正なら非公開漏れ（サイレント）→ Task2 ルールテストで担保。
- 移行漏れの既存doc → ルールの published フォールバックで破綻しない（Task2 legacyテストで担保）。
- page.tsx のサーバ化で既存の表示が壊れる可能性 → Task5 手動QAで確認。
