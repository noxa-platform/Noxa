import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveStoreAccess, resolveStoreAccessState } from '../../src/lib/store-access';

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

// Day109: 読み取りが失敗した（null）ときに「店舗が無い」と言い切らない層。
// 旧実装は所有・所属の両方が落ちると素通りで hasStore=false にしており、通信断で
// アカウント画面の店舗運営セクションが消え、さらに「＋ 店舗を登録すると解放」＝
// すでに店舗があるのに自分の店を作れという誘導が出ていた（Day105 と同型の誤誘導）。
describe('resolveStoreAccessState（読み取り失敗を「店舗が無い」と混ぜない）', () => {
  it('両方読めたら resolveStoreAccess と同じ結論（unresolved=false）', () => {
    expect(resolveStoreAccessState(['s1'], [])).toEqual({ hasStore: true, isOwner: true, unresolved: false });
    expect(resolveStoreAccessState([], ['s2'])).toEqual({ hasStore: true, isOwner: false, unresolved: false });
    expect(resolveStoreAccessState([], [])).toEqual({ hasStore: false, isOwner: false, unresolved: false });
  });

  it('★両方失敗したら hasStore=false を確定しない（店舗登録 CTA を出してはいけない）', () => {
    expect(resolveStoreAccessState(null, null)).toEqual({ hasStore: false, isOwner: false, unresolved: true });
  });

  it('★所属クエリだけ失敗＋所有が空なら確定しない（キャストが店舗 UI を失うのを防ぐ）', () => {
    expect(resolveStoreAccessState([], null)).toEqual({ hasStore: false, isOwner: false, unresolved: true });
  });

  it('肯定は片方だけでも確定する（1件でもあれば覆らない＝不要に劣化させない）', () => {
    expect(resolveStoreAccessState(['s1'], null)).toEqual({ hasStore: true, isOwner: true, unresolved: false });
  });

  it('★所有クエリが失敗した場合、所属で hasStore は出せても isOwner は確定しない', () => {
    // ここで unresolved=false にすると、オーナーに「＋ 自分のお店を登録する」を出してしまう
    expect(resolveStoreAccessState(null, ['s2'])).toEqual({ hasStore: true, isOwner: false, unresolved: true });
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('静的ガード（オーナー限定判定への逆戻りを検出）', () => {
  it('useShopContext は memberships 逆引きも読む', () => {
    const src = read('src/lib/useShopContext.ts');
    expect(src).toContain('/memberships');
    expect(src).toContain('resolveStoreAccessState');
  });

  it('読んだ memberships を判定に渡している（読むだけで空配列に戻す退化を検出）', () => {
    const src = read('src/lib/useShopContext.ts');
    // 読み取り結果を受ける変数名を取り出し、判定の第2引数がその変数由来であることを見る
    const readVar = /const\s+(\w+)\s*=\s*await\s+getDocs\(collection\(db,\s*`account_users\/\$\{uid\}\/memberships`\)\)/.exec(src)?.[1];
    expect(readVar).toBeTruthy();
    // 引数は複数行に分かれるので呼び出し全体（閉じ括弧まで）を取る
    const call = /resolveStoreAccessState\(([\s\S]*?)\);/.exec(src)?.[1];
    expect(call).toBeTruthy();
    // 読み取り変数そのものから docs を取り出して渡していること（`[]` 固定に戻すと落ちる）
    expect(call).toMatch(new RegExp(`\\b${readVar}\\b[?.]*\\.docs`));
    // 失敗（null）をそのまま渡すこと（?? [] で「空」に丸めると読み取り失敗が未所属に化ける・Day109）
    expect(call).toMatch(new RegExp(`\\b${readVar}\\b\\s*\\?`));
  });

  it('ダッシュボードの店舗運営セクションは hasShop（所属含む）でゲートし、isOwner でゲートしない', () => {
    const src = read('src/app/account/page.tsx');
    expect(src).toContain('{hasShop ? (');
    expect(src).not.toContain('{isOwner ? (');
  });

  it('店舗を登録する導線は所属メンバーにも残っている（既存導線の退化防止）', () => {
    const src = read('src/app/account/page.tsx');
    // 所有クエリが読めなかったときは出さない（Day109）ので、条件に shopCtxError が入る
    expect(src).toContain('!isOwner && !shopCtxError && (');
    expect((src.match(/href="\/store\/new"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('★店舗の確認に失敗した状態で「店舗を登録」を出さない（すでに店舗があるのに作れと誘導しない）', () => {
    // 「店舗が無い人向けの登録 CTA」より手前で、確認失敗の枝を受けていること
    for (const [p, cta] of [
      ['src/app/account/page.tsx', '＋ 店舗を登録すると解放'],
      ['src/components/AccountShell.tsx', '＋ お店を登録'],
    ] as const) {
      const src = read(p);
      const errBranch = src.indexOf('shopCtxError ? (');
      expect(errBranch, p).toBeGreaterThanOrEqual(0);
      expect(errBranch, p).toBeLessThan(src.indexOf(cta));
    }
  });
});
