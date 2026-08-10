import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveStoreAccess } from '../../src/lib/store-access';

// 「店舗運営モジュールの到達性」判定（Day105）。
// 招待で参加したメンバー（cast/manager/accounting）はオーナーではないため、
// オーナー限定判定だとダッシュボードに店舗モジュールが 1 つも出ない。
// スマホはサイドバー（hidden md:flex）が無く、下部タブにも勤怠が無いので
// 「打刻に到達できない」＝機能が丸ごと使えない状態になっていた。

describe('resolveStoreAccess（店舗運営セクションを出すかの単一判定）', () => {
  it('オーナー店舗があれば hasStore / isOwner ともに true', () => {
    expect(resolveStoreAccess(['s1'], [])).toEqual({ hasStore: true, isOwner: true });
  });

  it('★所属だけ（招待参加のキャスト）でも hasStore は true・isOwner は false', () => {
    // ここが false に戻ると、参加直後のキャストがスマホで打刻に到達できなくなる
    expect(resolveStoreAccess([], ['s1'])).toEqual({ hasStore: true, isOwner: false });
  });

  it('オーナー兼他店所属は hasStore / isOwner ともに true', () => {
    expect(resolveStoreAccess(['s1'], ['s2'])).toEqual({ hasStore: true, isOwner: true });
  });

  it('どちらも無い個人ユーザーだけが false（＝店舗登録 CTA の対象）', () => {
    expect(resolveStoreAccess([], [])).toEqual({ hasStore: false, isOwner: false });
  });

  it('memberships に自分のオーナー店が重複していても判定は変わらない（CF 同期で両方に載る）', () => {
    expect(resolveStoreAccess(['s1'], ['s1'])).toEqual({ hasStore: true, isOwner: true });
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('静的ガード（オーナー限定判定への逆戻りを検出）', () => {
  it('useShopContext は memberships 逆引きも読む', () => {
    const src = read('src/lib/useShopContext.ts');
    expect(src).toContain('/memberships');
    expect(src).toContain('resolveStoreAccess');
  });

  it('読んだ memberships を resolveStoreAccess に渡している（読むだけで空配列に戻す退化を検出）', () => {
    const src = read('src/lib/useShopContext.ts');
    // 読み取り結果を受ける変数名を取り出し、判定の第2引数がその変数由来であることを見る
    const readVar = /const\s+(\w+)\s*=\s*await\s+getDocs\(collection\(db,\s*`account_users\/\$\{uid\}\/memberships`\)\)/.exec(src)?.[1];
    expect(readVar).toBeTruthy();
    const call = /resolveStoreAccess\(.*$/m.exec(src)?.[0];
    expect(call).toBeTruthy();
    // 読み取り変数そのものから docs を取り出して渡していること（`[]` 固定に戻すと落ちる）
    expect(call).toMatch(new RegExp(`\\b${readVar}\\b[?.]*\\.docs`));
  });

  it('ダッシュボードの店舗運営セクションは hasShop（所属含む）でゲートし、isOwner でゲートしない', () => {
    const src = read('src/app/account/page.tsx');
    expect(src).toContain('{hasShop ? (');
    expect(src).not.toContain('{isOwner ? (');
  });

  it('店舗を登録する導線は所属メンバーにも残っている（既存導線の退化防止）', () => {
    const src = read('src/app/account/page.tsx');
    expect(src).toContain('!isOwner && (');
    expect((src.match(/href="\/store\/new"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
