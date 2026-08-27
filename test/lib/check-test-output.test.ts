import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// `scripts/check-test-output.sh` の自己テスト（P155）。
//
// ## なぜ要るか
// この判定は「テストが**走り切ったか**」を見る番人で、③部分的な沈黙
// （件数行はあるが少ない＝設定やグロブが縮んでも満点の緑に見える）を拾うために入れた。
// ⚠️ ところが**判定そのものは手で 5 通り当てて確かめただけ**だと、次に触る側は誰も確かめない。
//    「判定を仕組みにした本人が、その判定の検証は運用に頼る」形になる（yorulog が実際に踏んだ）。
//
// ## 実ログに当てる（合成しない）
// `scripts/fixtures/test-output/` は**実際に取った vitest の出力**。
// ⚠️ 判定側のバグは**合成入力だと通る**——yorulog は注意書きの文字列に裸のバッククォートを書き、
//    「印字するだけの行が `swift test` を実行していた」のを、実ログ 5 本に当てて初めて見つけた。
//
// ## 3 通りではなく「成功側も」見る
// ⚠️ **落ちること**だけを測ると、**成功側にだけあるバグ**が入る（yorulog は成功側の
//    `echo` 1 行が bash 3.2 で `unbound variable` になるのを危うく入れるところだった）。
//    正常系は**次に触る側が毎回通る唯一の経路**なので、3 通りの中で一番大事。

const CHECKER = join(process.cwd(), 'scripts/check-test-output.sh');
const FIX = join(process.cwd(), 'scripts/fixtures/test-output');
const fixture = (name: string) => join(FIX, name);

/** 判定を走らせて {status, out} を返す（例外にせず終了コードを見る） */
function run(log: string, vitestStatus: number, minFiles = 120, minTests = 1700) {
  try {
    const out = execFileSync('bash', [CHECKER, log, String(vitestStatus), String(minFiles), String(minTests)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('check-test-output.sh — 走り切ったかの判定（実ログに当てる）', () => {
  it('③正常: 全部走って全緑なら 0（**毎回通る唯一の経路**）', () => {
    const r = run(fixture('normal-full-green.log'), 0);
    expect(r.status).toBe(0);
    expect(r.out).toContain('148 ファイル / 1935 件');
    expect(r.out).toContain('全緑');
  });

  it('①テスト失敗: 走り切っていても失敗があれば非 0（終了コードを引き継ぐ）', () => {
    const r = run(fixture('full-run-with-failure.log'), 1);
    expect(r.status).toBe(1);
    expect(r.out).toContain('テストに失敗あり');
  });

  it('②部分的な沈黙: 件数行はあるが少ない → 非 0', () => {
    const r = run(fixture('partial-1file-green.log'), 0);
    expect(r.status).toBe(1);
    // 「落ちなかった」ではなく「走っていない」と言うこと。ここを取り違えると穴なしに化ける
    expect(r.out).toContain('走っていません');
  });

  it('②全部の沈黙: 件数行が無ければ非 0', () => {
    const r = run(fixture('no-test-files.log'), 1);
    expect(r.status).toBe(1);
    expect(r.out).toContain('件数行がありません');
  });

  it('ログが空なら非 0（実行そのものが始まっていない）', () => {
    const r = run(fixture('empty.log'), 0);
    expect(r.status).toBe(1);
    expect(r.out).toContain('空です');
  });

  it('下限を実測より高くすれば正常ログでも落ちる（比較が効いている）', () => {
    // ⚠️ 測れるのは「**比較が効くこと**」であって「実クラッシュが必ず低い件数を出すこと」ではない
    const r = run(fixture('normal-full-green.log'), 0, 99999, 99999);
    expect(r.status).toBe(1);
  });

  it('フィクスチャが実在する（走査の空振り防止）', () => {
    const files = readdirSync(FIX).filter((f) => f.endsWith('.log')).sort();
    expect(files).toEqual([
      'empty.log', 'full-run-with-failure.log', 'no-test-files.log',
      'normal-full-green.log', 'partial-1file-green.log',
    ]);
  });
});
