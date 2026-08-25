import { describe, it, expect } from 'vitest';
import { computeDraftPayroll } from '../../src/lib/payroll/draft';

// キャスト本人が見る「見込み給与」。P153-PM23 で画面コンポーネントから切り出した。
//
// ⚠️ 一番の論点は**時間に入らなかった勤務を黙って落とさないこと**。
// オーナー側の確定画面には「打刻漏れ n 件」の警告が出るのに、**本人が見る見込みだけ
// 黙って少ない額**になっており、本人には減った理由が分からなかった。
// 金額が絡む欠落は、欠落そのものより**気づく手がかりが無いこと**が問題。

const ts = (ms: number) => ({ toMillis: () => ms });
const H = 3600_000;

describe('computeDraftPayroll — 見込み給与', () => {
  it('当月の閉じた勤務だけを時間に入れる', () => {
    const r = computeDraftPayroll([
      { date: '2026-08-01', startAt: ts(0), endAt: ts(5 * H) },
      { date: '2026-08-02', startAt: ts(0), endAt: ts(3 * H) },
      { date: '2026-07-31', startAt: ts(0), endAt: ts(9 * H) }, // 前月は無視
    ], '2026-08', 2000);
    expect(r.hours).toBe(8);
    expect(r.base).toBe(16000);
    expect(r.staleOpens).toBe(0);
  });

  it('**退勤打刻の無い勤務は件数で返す**（黙って消さない）', () => {
    const r = computeDraftPayroll([
      { date: '2026-08-01', startAt: ts(0), endAt: ts(5 * H) },
      { date: '2026-08-02', startAt: ts(0) },                    // 未退勤
      { date: '2026-08-03', startAt: ts(3 * H), endAt: ts(H) },  // end <= start の壊れた行
    ], '2026-08', 1000);
    expect(r.hours).toBe(5);
    expect(r.staleOpens).toBe(2);
  });

  // ⚠️ 出勤打刻すら無い行は「勤務の記録が無い」だけで、打刻漏れではない。
  // ここを数えると、予定だけ入っている行まで「打刻漏れ」として警告が出る
  it('出勤打刻の無い行は打刻漏れに数えない', () => {
    const r = computeDraftPayroll([{ date: '2026-08-01' }, { date: '2026-08-02', endAt: ts(H) }], '2026-08', 1000);
    expect(r.staleOpens).toBe(0);
    expect(r.minutes).toBe(0);
  });

  // ⚠️ **全部が打刻漏れでも 0 件にはしない**。呼び出し側はこの件数を見て
  // 「見込みカードを出すか」を決める（旧実装は分数 0 でカードごと消え、
  //  **今月は働いていない**ように見えていた）
  it('全部が打刻漏れなら 時間 0・件数あり（カードを消す判断を呼び出し側に残す）', () => {
    const r = computeDraftPayroll([
      { date: '2026-08-01', startAt: ts(0) },
      { date: '2026-08-02', startAt: ts(0) },
    ], '2026-08', 1000);
    expect(r.minutes).toBe(0);
    expect(r.base).toBe(0);
    expect(r.staleOpens).toBe(2);
  });

  it('数値（ミリ秒）で保存された打刻も読む（toMillis の緩い側に揃っている）', () => {
    const r = computeDraftPayroll([{ date: '2026-08-01', startAt: 0, endAt: 2 * H }], '2026-08', 1500);
    expect(r.hours).toBe(2);
    expect(r.base).toBe(3000);
  });

  it('時給が無い・壊れているときは 0 円（NaN を出さない）', () => {
    for (const wage of [0, -100, NaN, Infinity]) {
      const r = computeDraftPayroll([{ date: '2026-08-01', startAt: ts(0), endAt: ts(H) }], '2026-08', wage);
      expect(r.base).toBe(0);
      expect(Number.isFinite(r.base)).toBe(true);
    }
  });

  it('日付が無い・型違いの行は当月と判定しない（他人の月に混ぜない）', () => {
    const r = computeDraftPayroll([
      { startAt: ts(0), endAt: ts(H) },
      { date: 20260801 as unknown as string, startAt: ts(0), endAt: ts(H) },
    ], '2026-08', 1000);
    expect(r.minutes).toBe(0);
    expect(r.staleOpens).toBe(0);
  });

  // P154-PM2: 「数えていない」の一段手前に「区別していない」がある（yorulog の原則）。
  // 「別の月だった」＝正しい絞り込み と「日付が読めない」＝欠陥 を 1 つの continue に
  // 畳んでいたため、**壊れた行が正しい絞り込みに紛れて数えられなかった**。
  it('日付が読めない勤務は「別の月」と区別して undated に数える', () => {
    const r = computeDraftPayroll([
      { date: '2026-08-01', startAt: ts(0), endAt: ts(H) },       // 当月・正常
      { date: '2026-07-31', startAt: ts(0), endAt: ts(H) },       // 別の月（正しい絞り込み・数えない）
      { startAt: ts(0), endAt: ts(H) },                            // 日付が無い（欠陥）
      { date: '   ', startAt: ts(0), endAt: ts(H) },               // 空白だけ（欠陥）
      { date: 20260801 as unknown as string, startAt: ts(0) },     // 型違い（欠陥）
    ], '2026-08', 1000);
    expect(r.minutes).toBe(60);   // 当月の 1 件だけ
    expect(r.undated).toBe(3);
    expect(r.staleOpens).toBe(0); // 日付が読めない行は打刻漏れとは別勘定
  });

  it('日付が読めなくても出勤打刻すら無い行は数えない（勤務の記録が無いだけ）', () => {
    const r = computeDraftPayroll([{ endAt: ts(H) }, {}], '2026-08', 1000);
    expect(r.undated).toBe(0);
    expect(r.staleOpens).toBe(0);
  });

  it('「別の月」は undated に数えない（正しい絞り込みを欠陥に混ぜない）', () => {
    const r = computeDraftPayroll([
      { date: '2026-07-01', startAt: ts(0), endAt: ts(H) },
      { date: '2026-09-30', startAt: ts(0) },
    ], '2026-08', 1000);
    expect(r.undated).toBe(0);
    expect(r.minutes).toBe(0);
  });
});
