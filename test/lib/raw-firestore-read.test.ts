import { describe, it, expect } from 'vitest';
import { stripComments } from '../helpers/strip-comments';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// 「型検証を通さず生データを読む」経路のラチェット（P161 新設）。
//
// ## なぜテストで数えるのか
// P157（書く）/ P160（出す）/ P161（予約・体験入店・席回し）で潰したのは、
// **読むときに未知を既定へ丸める**形。丸めを外すと、未知の値は `Record<Union, Meta>` の
// 表引きで `undefined` になり、**落ちて気づける**ようになる。
// 🔴 **しかしそれで網羅にはならない。** `snap.data() as T` は実行時に何も検証しないので、
// **丸めが無くても落ちない**。丸めを外して出た箇所を全部潰しても、この経路は丸ごと外に残る。
// ＝ 「対処の存在は網羅の証拠にならない」の**検出器版**（落ちる箇所の網羅 ≠ 問題の網羅）。
//
// ## なぜ 1 件ずつ直さないのか
// yorulog（iOS）は同じ形が 4 箇所だったので正本関数 1 つに寄せて終えられた。
// Web は 110 箇所ある。**寄せ先を作る前に数だけ動かすと、減った理由が誰にも分からなくなる**ので、
// まず**現在値を固定**し、増えたら赤・減ったら「なぜ減ったか」を書かせる形にする。
//
// ⚠️ 起票時の見積りは「63 箇所」だったが、それは `src/components` と `src/lib` だけを
// 数えた値だった（`src/app/api` の 42 箇所が入っていない）。**走査範囲を書かない数字は、
// 次に読む人が全域だと読む。** ここでは走査範囲をコードで固定する。

/**
 * 走査ルート。**ここが母集団の唯一の正本**で、文章の側で範囲を広く言わない（P161-PM4 の教訓）。
 * P165 で `functions/src` を追加（母集団の追加なので additive＝誤検知の測定は不要）。
 */
const ROOTS = ['src', 'functions/src'] as const;

/** ファイルごとの現在値。⚠️ 増やすときは理由を、減らすときは**減った理由を確かめてから**下げる。 */
const BASELINE: Record<string, number> = {
  'src/app/account/link/page.tsx': 1,
  'src/app/account/notifications/page.tsx': 2,
  'src/app/account/page.tsx': 1,
  'src/app/account/subscription/page.tsx': 1,
  'src/app/api/ai/customer-infer-profile/route.ts': 2,
  'src/app/api/ai/rule-pack/route.ts': 1,
  'src/app/api/community/admin/action/route.ts': 1,
  'src/app/api/community/admin/reports/route.ts': 3,
  'src/app/api/community/issue-invite/route.ts': 2,
  'src/app/api/community/me/route.ts': 2,
  'src/app/api/community/redeem-invite/route.ts': 2,
  'src/app/api/feedback/route.ts': 1,
  'src/app/api/lib/access-context.ts': 1,
  'src/app/api/lib/ai-kill-switch.ts': 1,
  'src/app/api/lib/firebase-admin.ts': 1,
  'src/app/api/lib/team-auth.ts': 2,
  'src/app/api/team/assign-customer/route.ts': 3,
  'src/app/api/team/cast-customers/route.ts': 4,
  'src/app/api/team/finalize-payroll/route.ts': 6,
  'src/app/api/team/member-stats/route.ts': 6,
  'src/app/api/team/redeem-invite/route.ts': 4,
  'src/components/AccountShell.tsx': 1,
  'src/components/modules/attendance/AttendanceClient.tsx': 4,
  'src/components/modules/customers/CustomersClient.tsx': 1,
  'src/components/modules/goals/GoalsClient.tsx': 1,
  'src/components/modules/payroll/PayrollClient.tsx': 2,
  'src/components/modules/personal-calc/CalcClient.tsx': 2,
  'src/components/modules/pos-config/PosConfigClient.tsx': 1,
  'src/components/modules/reservation/ReservationClient.tsx': 5,
  'src/components/modules/sales/SalesClient.tsx': 2,
  'src/components/modules/seating/SeatingClient.tsx': 3,
  'src/components/modules/transport/TransportClient.tsx': 2,
  'src/components/modules/unpaid/UnpaidClient.tsx': 1,
  'src/components/store/MembersSection.tsx': 2,
  'src/lib/ai-knowledge/prompt-helpers.ts': 1,
  'src/lib/community/firestore-repository.ts': 1,
  'src/lib/handle.ts': 1,
  'src/lib/menu/store.ts': 7,
  'src/lib/pos/store.ts': 5,
  'src/lib/seating/store.ts': 17,
  'src/lib/shopConfig.ts': 1,
  'src/lib/useShopRole.ts': 1,
  'src/lib/workspace.ts': 2,

  // ── functions/src（P165 で母集団に追加・2026-09-07 実測）────────────────────
  // ⚠️ CF は**トリガで派生データを書く**ので、生読みの取り違えが保存済みデータへ伝播し、
  // 画面が無いので誰も気付かない。API ルートより上流にある。
  'functions/src/lib/prefs.ts': 1,
  'functions/src/lib/push.ts': 1,
  'functions/src/merge.ts': 1,
  'functions/src/noxa-auth.ts': 1,
};

const TOTAL = Object.values(BASELINE).reduce((a, b) => a + b, 0);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// ⚠️ 生ソースに当てると、**コメントの言及を実装として数える**（P161-PM で実測）。
// 判定はコードだけに当てる（`test/helpers/strip-comments.ts` は Day121-PM からある共通ヘルパー。
// 🔴 P161 で新設したとき、**既にあるこれを使っていなかった**）。
const FILES = ROOTS.flatMap((root) =>
  sourceFiles(join(process.cwd(), root)).map((p) => ({
    root,
    path: relative(process.cwd(), p).split(/[\\/]/).join('/'),
    src: stripComments(readFileSync(p, 'utf8')),
  })),
);

/** `snap.data() as T` / `d.data() as Partial<T>` … 実行時に検証されない読み */
const RAW_READ = /\.data\(\) as /g;

/**
 * ⚠️ **`as` の付かない `.data()` は、この走査から丸ごと外れる**（P161-PM4 で実測）。
 * `src/` で **110 対 111** ——「`.data() as` が 110 件」は**半分の綴りを数えた数**だった。
 *
 * ✅ **【P165 で解消】`functions/src` を母集団に追加した**（2026-09-07）。
 * ⚠️ Cloud Functions は**トリガで派生データを書く**ので、生読みの取り違えが
 * **保存済みデータに伝播し、画面が無いので誰も気付かない**。API ルートより上流。
 * 実測は **23 ファイル・34 出現**（`.data() as` 4 ／ `as` なし 30）で生 grep と一致。
 * コメント内の言及はゼロだった＝起票時の「34」は正しかった。
 * 🔴 **間違っていたのは、追加しようとした側の走査だった。** 最初の測定は `lib` という名前の
 * ディレクトリを一律に除外していて、`functions/src/lib/`（実ソース 6 ファイル・8 出現）を落とし、
 * 合計が **26** に見えていた。除外の理由は「ビルド成果物だろう」という**確かめていない推測**。
 * ＝ 母集団が静かに縮む 3 つ目の形。P161 は**走査範囲**（`src/app/api` の数え忘れ）、
 * P161-PM4 は**走査する綴りと数え方**（`as` 無しの半分・行 vs 出現）、今回は**除外リスト**。
 * 💡 3 回とも「数字だけが独り歩きし、その数字がどう作られたかが書かれていなかった」。
 * ⇒ 走査範囲は `ROOTS`、除外は `sourceFiles` が唯一の正本。**文章の側で範囲を言わない。**
 * ⇒ `scripts/` は `.mjs` しか無く、この走査の**拡張子フィルタの外**（末尾の専用テストで数だけ固定）。
 *
 * 中身は一様ではない: `mapReservation(d.id, d.data())` のように**項目ごとに検証する
 * 写像関数へ渡す**（＝正しい形）ものと、`d.data().hourlyWage as number` のように
 * **生のまま項目を取り出す**ものが混在する。前者は直す対象ではない。
 * ここでは**分類せず母集団だけ固定**する（分類は P162。yorulog の
 * 「変種は走査の側で潰す／名前付き型へ寄せる方針は取らない」と同じ判断）。
 *
 * ✅ **【P166】`functions/src` の 34 件を 1 件ずつ判定した**（内訳は grind LOG の P166 に全件表）。
 * 判定は「その `.data()` から**項目を型として取り出しているか**」の一軸:
 *   - **A: 丸ごと運ぶ / 存在確認だけ**（11 件）——`merge.ts` の doc コピー、
 *     `v2-sync.ts` の `if (!after) return`、audit ログの before など。項目を主張しないので
 *     この経路の危険は無い（丸ごとコピーの是非は別問題）。
 *   - **B: 型で選り分けてから使う**（10 件 → P166 で 12 件）——`sales-sync.ts` の
 *     `num()` / `str()` / `typeof x === 'string'` 経由＝正しい形。
 *   - 🔴 **C: 生のまま項目を取り出す**（13 件 → P166 で 11 件）——`(data.totalSales as number) ?? 0` 型。
 *     `as` は実行時に何も検証せず、`?? 0` が守るのは null / undefined だけなので**型違いは素通り**。
 * 💡 **A と B と C は同じリポの中に並んでいて、どれになるかは
 * 「どちらが正しいか」ではなく「たまたまどちらを書いたか」で決まっていた**
 *（`sales-sync.ts` は自前の `num`/`str` を持っていたのに、時刻だけ素通しだった）。
 *
 * P166 で C → B にしたのは **`lib/workspaces.ts` の 2 件**（`listCustomers` /
 * `listLogsInRange`）。ここだけ先に直したのは、**読み手が `.toMillis()` を直接呼んでいて、
 * 型違いが来ると利用者ごと通知が throw で消える**＝落ち方が一番重かったから。
 * ⚠️ **残る C の 11 件は未消化**（`lib/stats.ts` / `credits.ts` / `lib/prefs.ts` / `lib/push.ts` /
 * `lib/workspaces.ts:46,47,54` / `v2-sync.ts:122,188` / `noxa-auth.ts:107,179`）。
 * 数を揃えるだけなら今日できるが、**既定へ倒す向きが場所ごとに違う**——
 * 送信統計の `?? 0`（表示）とクレジットの `?? amount`（課金の巻き戻し）、
 * 通知設定の欠落（配信する / しない）は、揃えた瞬間に fail-safe の向きを壊し得る。
 * ⇒ 向きの判断が要るものを「型を締める」ついでに混ぜない。
 */
const RAW_READ_UNCAST = /\.data\(\)(?! as )/g;

const counts = new Map<string, number>();
for (const f of FILES) {
  const n = [...f.src.matchAll(RAW_READ)].length;
  if (n > 0) counts.set(f.path, n);
}

/**
 * `as` の付かない `.data()` の総数（母集団のもう半分・P161-PM4）。
 * ⚠️ **111 であって 110 ではない。** シェルの `grep -c` は **行単位**で数えるので、
 * `src/lib/useTheme.ts:48` の**1 行に 2 つある `.data()`** を 1 と数えていた。
 * ＝ **綴りを直した走査が、今度は数え方（行 vs 出現）で外していた。**
 * 目視で 1 件確かめるまで、この 1 件差は「まあ 110 だろう」で通っていた。
 */
const UNCAST_TOTAL: Record<(typeof ROOTS)[number], number> = {
  src: 111,
  // P165 で追加。生 grep の 34 と一致し、**コメント内の言及はゼロ**だった
  //（`.data() as` 4 件は BASELINE 側に載っている）。
  'functions/src': 30,
};
const uncastByRoot = Object.fromEntries(ROOTS.map((r) => [r, 0])) as Record<string, number>;
for (const f of FILES) uncastByRoot[f.root] += [...f.src.matchAll(RAW_READ_UNCAST)].length;

describe('生データ経路のラチェット（.data() as）', () => {
  // ⚠️ グロブが破綻して 0 件になれば、このテストは**全部緑**で通ってしまう（沈黙の段 1）
  it('走査対象が取れている（空振り防止）', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(counts.size).toBeGreaterThan(30);
  });

  it('合計が増えていない', () => {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(TOTAL);
  });

  it('ファイル単位で増えていない（合計だけ見ると相殺で隠れる）', () => {
    const grown = [...counts.entries()]
      .filter(([p, n]) => n > (BASELINE[p] ?? 0))
      .map(([p, n]) => `${p}: ${BASELINE[p] ?? 0} → ${n}`);
    // 新しい生読みを足すなら、まず寄せ先（型検証を通す関数）へ通すこと
    expect(grown).toEqual([]);
  });

  // ⚠️ 走査が **1 つの綴りしか見ていない**と、母集団は静かに半分になる（P161-PM4）
  it('`as` の付かない `.data()` も母集団として固定されている（走査ルート別）', () => {
    // ⚠️ ルートを合算すると、片方が減って片方が増えたときに**相殺で隠れる**
    //（`BASELINE` をファイル単位にしているのと同じ理由）。
    expect(uncastByRoot).toEqual(UNCAST_TOTAL);
  });

  /**
   * 🔴 P165 で実測した穴: 走査の**除外リスト**が母集団を静かに縮める。
   * `functions/src/lib/` は**ビルド成果物ではなく実ソース**（`admin-check` / `datetime` /
   * `prefs` / `push` / `stats` / `workspaces`）。`lib` という名前だけで除外すると
   * **6 ファイル・8 出現**が母集団から消え、合計が 34 ではなく 26 に見える。
   * ＝ P161 の「走査範囲」、P161-PM4 の「走査する綴り／数え方」に続く**3 つ目の縮み方**。
   * 上の `toEqual` が 30 を要求するので、この除外が戻れば赤になる。
   */
  it('functions/src/lib を実ソースとして走査できている', () => {
    const libFiles = FILES.filter((f) => f.path.startsWith('functions/src/lib/'));
    // 6 → 7（P166 で寄せ先 `values.ts` を新設）。⚠️ 数だけ動かすと除外が戻ったのか
    // ファイルが増えたのか区別できないので、**在るべき実ソース名の方も固定する**
    expect(libFiles.map((f) => f.path).sort()).toEqual([
      'functions/src/lib/admin-check.ts',
      'functions/src/lib/datetime.ts',
      'functions/src/lib/prefs.ts',
      'functions/src/lib/push.ts',
      'functions/src/lib/stats.ts',
      'functions/src/lib/values.ts',
      'functions/src/lib/workspaces.ts',
    ]);
  });

  /**
   * ⚠️ `scripts/` は **`.mjs` しか無い**ので、上の走査（`.ts` / `.tsx`）の
   * **拡張子フィルタから丸ごと外れている**（2026-09-07 実測: `.data()` が 4 出現）。
   * 除外を書かずに 0 件で通すと「`scripts` には無い」と読めてしまうので、数だけ固定する。
   * ⚠️ ここは一度きりの移行スクリプト置き場で、常駐経路ではないため寄せ先は作らない。
   */
  it('scripts/ の .mjs も数だけ固定する（拡張子フィルタの外）', () => {
    const dir = join(process.cwd(), 'scripts');
    const total = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
      .reduce(
        (acc, e) =>
          acc + [...stripComments(readFileSync(join(dir, e.name), 'utf8')).matchAll(/\.data\(\)/g)].length,
        0,
      );
    expect(total).toBe(4);
  });

  it('減った分は理由を確かめてから baseline を下げる', () => {
    // ⚠️ 「下限を下げるときは、下げる前になぜ減ったかを確かめる」。
    // ファイルを消したのか、寄せ先へ通したのかで意味がまったく違う
    const shrunk = [...Object.entries(BASELINE)]
      .filter(([p, n]) => (counts.get(p) ?? 0) < n)
      .map(([p, n]) => `${p}: ${n} → ${counts.get(p) ?? 0}`);
    expect(shrunk).toEqual([]);
  });
});
