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

const ROOT = join(process.cwd(), 'src');

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
const FILES = sourceFiles(ROOT).map((p) => ({
  path: relative(process.cwd(), p).split(/[\\/]/).join('/'),
  src: stripComments(readFileSync(p, 'utf8')),
}));

/** `snap.data() as T` / `d.data() as Partial<T>` … 実行時に検証されない読み */
const RAW_READ = /\.data\(\) as /g;

/**
 * ⚠️ **`as` の付かない `.data()` は、この走査から丸ごと外れる**（P161-PM4 で実測）。
 * `src/` で **110 対 111** ——「`.data() as` が 110 件」は**半分の綴りを数えた数**だった。
 *
 * 🔴 **さらにこの走査は `src/` しか見ていない。** `functions/src` に **`.data()` が 34 箇所**
 * （23 ファイル）、`scripts/` に 4 箇所あり、**どちらもここには入っていない**（2026-08-29 実測）。
 * ⚠️ Cloud Functions は**トリガで派生データを書く**ので、生読みの取り違えが
 * **保存済みデータに伝播し、画面が無いので誰も気付かない**。API ルートより上流。
 * ＝ **「全域」と書きかけた**（P161-PM4 の初稿がそうだった）。走査範囲は `ROOT` が唯一の正本で、
 * **文章の側で範囲を広く言わない**。⇒ `functions/src` を足すのは P162 以降（母集団の追加なので
 * **締める方向ではなく additive**＝誤検知の測定は不要）。
 * 🔴 これは P161 起票時の「63 件」（`src/app/api` を数え忘れ）と**同じ誤り**で、
 * あのときは**走査範囲**、今回は**走査する綴り**を書かずに数字だけ渡していた。
 *
 * 中身は一様ではない: `mapReservation(d.id, d.data())` のように**項目ごとに検証する
 * 写像関数へ渡す**（＝正しい形）ものと、`d.data().hourlyWage as number` のように
 * **生のまま項目を取り出す**ものが混在する。前者は直す対象ではない。
 * ここでは**分類せず母集団だけ固定**する（分類は P162。yorulog の
 * 「変種は走査の側で潰す／名前付き型へ寄せる方針は取らない」と同じ判断）。
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
const UNCAST_TOTAL = 111;
const uncastTotal = FILES.reduce((acc, f) => acc + [...f.src.matchAll(RAW_READ_UNCAST)].length, 0);

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
  it('`as` の付かない `.data()` も母集団として固定されている', () => {
    expect(uncastTotal).toBe(UNCAST_TOTAL);
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
