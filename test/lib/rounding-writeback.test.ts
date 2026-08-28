import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../helpers/strip-comments';

// 丸め 3 経路の横展開ガード（P161）。
//
// P157（書く）/ P160（出す）は `TransportClient` だけを直した。同じ形が他にもあるかを
// **モジュールごとに名指しで数えた**結果:
//   - `ReservationClient` … 読みで `未来店` へ丸め。表示・集計・遷移ボタンが丸めた値を見ていた
//   - `TrialClient`       … 読みで `applied` へ丸め。**名前だけ直した保存でも段階を上書き**していた
//   - `SeatingClient`     … 🔴 読みでは丸めていないのに、**遷移の else 節**が既定へ丸めていた
//   - `BusinessCardClient`… 該当なし（保存値をそのまま出し、表引きは `?? 既定色` で受けている）
//   - `InventoryClient`   … 該当なし（状態は数量から導出しており、保存値ではない）
//
// 💡 `SeatingClient` の形が示すのは、**丸めは読みだけに住むわけではない**ということ。
// `toStatus` のような関数も `includes(...) ? ... : 既定` も無く、
// `a === 'Free' ? 'Break' : a === 'Break' ? 'Absent' : 'Free'` の**最後の else** に住んでいた。
// ＝ 読みだけを grep していたら見つからない。

// 🔴 生ソースに当てると、**守りをコメントにするだけでガードが緑のまま通る**（P161-PM で実測）。
// 「消す」と「コメントにする」は別の壊し方で、**後者だけが判定を素通りする**。
// ⚠️ 文字列とテンプレートリテラルの中身は残る（`aria-label={\`…\`}` を見る assert があるため）。
const read = (p: string) => stripComments(readFileSync(p, 'utf8'));

describe('ReservationClient — 予約の「未来店」は来ていない人として扱われる', () => {
  const SRC = 'src/components/modules/reservation/ReservationClient.tsx';
  const src = read(SRC);

  it('走査対象が取れている（空振り防止）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('STATUS_COLOR');
  });

  // 書く: 生の値を控えていないと、以降のどの判断も丸めた値の上でしかできない
  it('読み込みで生の値を控えている（statusRaw）', () => {
    expect(src).toMatch(/statusRaw: d\.status/);
  });

  // 書く: 来店処理は status の上書きだけでなく**開卓と初期伝票の作成**まで進む
  it('来店処理が上書き確認を通る', () => {
    const guard = src.indexOf('confirmOverwriteStatus');
    expect(guard).toBeGreaterThan(-1);
    expect(src).toMatch(/const checkIn = async \(r: Reservation\) => \{[\s\S]{0,400}?confirmOverwriteStatus\(r, '来店済'\)/);
  });

  // 出す: 丸めたラベルで言い切らない
  it('未知の状態は保存値のまま出す', () => {
    expect(src).toMatch(/statusUnknown\s*\?\s*unknownValueLabel\(r\.statusRaw\)/);
    // バッジ本文と aria-label が**同じ文言**を使う（読み上げだけ嘘が残るのを防ぐ）
    expect(src).toContain('aria-label={`ステータス: ${statusLabel}`}');
    expect(src).toContain('{statusLabel}');
  });

  // 出す（集計）: 「まだ来ていない人」に混ぜない
  it('集計が不明を未来店へ混ぜない', () => {
    expect(src).toMatch(/upcoming:\s*dayReservations\.filter\(\(r\) => !isUnknownValue\(/);
    expect(src).toMatch(/unknown:\s*dayReservations\.filter\(\(r\) => isUnknownValue\(/);
  });

  // 出す（操作）: 現在値が分からないのに「現在値を除く」はできない
  it('未知のときは 3 つの遷移をすべて出す', () => {
    expect(src).toMatch(/statusUnknown \? STATUSES : STATUSES\.filter/);
  });
});

describe('TrialClient — 名前を直しただけの保存で段階が消えていた', () => {
  const SRC = 'src/components/modules/trial/TrialClient.tsx';
  const src = read(SRC);

  it('走査対象が取れている（空振り防止）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('PIPELINE_STEPS');
  });

  it('読み込みで生の値を控えている（statusRaw）', () => {
    expect(src).toMatch(/statusRaw: d\.status/);
  });

  // 🔴 ここが本丸。編集フォームは status を**常に**payload へ載せていた
  it('未知の段階は保存 payload から外れる', () => {
    expect(src).toMatch(/\.\.\.\(d\.status === null \? \{\} : \{ status: d\.status \}\)/);
    expect(src).toMatch(/status: isUnknownValue\(c\.statusRaw, isTrialStatus\) \? null : c\.status/);
  });

  it('未知の段階から「次」を決めない', () => {
    const guard = src.indexOf('isOverwritable(c.statusRaw, isTrialStatus)');
    const use = src.indexOf('const next = nextStatus(c.status)');
    expect(guard).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(guard);
  });

  it('本入店・不採用は確認してから通す（一律に断ると機能が退化する）', () => {
    expect([...src.matchAll(/confirmOverwriteStatus\(c, '(本入店|不採用)'\)/g)]).toHaveLength(2);
  });

  it('パイプラインの件数と絞り込みが不明を既定の段へ混ぜない', () => {
    expect(src).toMatch(/const count = known\.filter\(\(c\) => c\.status === step\.key\)\.length/);
    expect(src).toContain("filterStatus === 'unknown'");
  });
});

describe('SeatingClient — 丸めは遷移の else 節にも住む', () => {
  const SRC = 'src/components/modules/seating/SeatingClient.tsx';
  const src = read(SRC);

  it('走査対象が取れている（空振り防止）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('STATUS_LABEL');
  });

  // 読みは丸めていない。危ないのは**書く側**——三項の最後が既定 'Free'
  it('状態切替が上書き判定より後で次を決める', () => {
    const guard = src.indexOf('isOverwritable(c.status, isCastStatus)');
    const use = src.indexOf("const next = c.status === 'Free'");
    expect(guard).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(guard);
  });

  // 出す: `Record` の表引きは未知キーで undefined を返し、**ラベルが消えるだけ**だった
  it('未知の状態でもラベルが消えない', () => {
    expect(src).toMatch(/isUnknownValue\(c\.status, isCastStatus\) \? unknownValueLabel\(c\.status\)/);
  });
});

describe('該当なしと実測したモジュール（次に見る人が数え直さなくていいように）', () => {
  it('BusinessCardClient は保存値をそのまま出している', () => {
    const src = read('src/components/modules/business-card/BusinessCardClient.tsx');
    // 表引きは `?? 既定色` で受け、**ラベルは保存値そのもの**を出す＝丸めていない
    expect(src).toMatch(/STATUS_COLOR\[status\] \?\? 'var\(--noxa-text-faint\)'/);
    expect(src).not.toMatch(/STATUS_COLOR\[status\]\.label/);
  });

  it('在庫の状態は保存値ではなく数量からの導出', () => {
    const src = read('src/lib/inventory/status.ts');
    expect(src).toMatch(/export function stockStatus\(qty: number, par: number\): StockStatus/);
  });
});
