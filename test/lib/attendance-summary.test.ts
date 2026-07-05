// Day9: 勤怠のチーム集計（summarizeTeamShifts）のテスト。
import { describe, it, expect } from 'vitest';
import { summarizeTeamShifts, type TeamShift } from '../../src/lib/attendance/summary';

const TODAY = '2026-07-05';
const NOW = new Date('2026-07-05T22:00:00').getTime();
const at = (hm: string, date = TODAY) => new Date(`${date}T${hm}:00`).getTime();

describe('summarizeTeamShifts', () => {
  it('勤務中/退勤済/未出勤を判定し、勤務中→本日済→他の順に並ぶ', () => {
    const shifts: TeamShift[] = [
      { castUid: 'done', date: TODAY, startMs: at('19:00'), endMs: at('21:00') },
      { castUid: 'working', date: TODAY, startMs: at('20:00'), endMs: null },
      { castUid: 'past', date: '2026-07-01', startMs: at('19:00', '2026-07-01'), endMs: at('23:00', '2026-07-01') },
    ];
    const rows = summarizeTeamShifts(shifts, TODAY, NOW);
    expect(rows.map((r) => [r.castUid, r.today])).toEqual([
      ['working', 'working'], ['done', 'done'], ['past', 'none'],
    ]);
    expect(rows[0].todayMinutes).toBe(120); // 20:00→22:00（now まで）
    expect(rows[1].todayMinutes).toBe(120); // 19:00→21:00
  });

  it('月間は日数（重複日は1）と合計分。過去日の退勤忘れは時間に計上せず件数で警告', () => {
    const shifts: TeamShift[] = [
      { castUid: 'a', date: '2026-07-01', startMs: at('19:00', '2026-07-01'), endMs: at('20:00', '2026-07-01') },
      { castUid: 'a', date: '2026-07-01', startMs: at('21:00', '2026-07-01'), endMs: at('22:00', '2026-07-01') }, // 同日2勤務
      { castUid: 'a', date: '2026-07-02', startMs: at('19:00', '2026-07-02'), endMs: null }, // 退勤忘れ
    ];
    const [a] = summarizeTeamShifts(shifts, TODAY, NOW);
    expect(a.monthDays).toBe(2);
    expect(a.monthMinutes).toBe(120); // 忘れ分は 0 計上
    expect(a.staleOpenCount).toBe(1);
    expect(a.today).toBe('none');
  });

  it('castUid 欠損や start>end の壊れデータに耐える', () => {
    const shifts: TeamShift[] = [
      { castUid: '', date: TODAY, startMs: at('19:00'), endMs: at('20:00') },
      { castUid: 'x', date: TODAY, startMs: at('23:00'), endMs: at('19:00') }, // 逆転
    ];
    const rows = summarizeTeamShifts(shifts, TODAY, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].todayMinutes).toBe(0);
    expect(rows[0].today).toBe('done'); // endMs はあるので「済」扱い
  });
});
