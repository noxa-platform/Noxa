/**
 * 勤怠のチーム集計（純ロジック・Day9: オーナー横断一覧）。
 * shifts（castUid/date/startMs/endMs）から、キャスト別の
 * 当日状況（勤務中/退勤済/未出勤）と月間合計を導出する。
 */

export type TeamShift = {
  castUid: string;
  date: string; // YYYY-MM-DD
  startMs: number | null;
  endMs: number | null;
};

export type CastAttendance = {
  castUid: string;
  /** 当日の状態 */
  today: 'working' | 'done' | 'none';
  todayStartMs: number | null;
  todayMinutes: number; // 当日の合計勤務分（勤務中は now まで）
  monthDays: number;    // 月間出勤日数（重複日は1）
  monthMinutes: number; // 月間合計勤務分（未退勤レコードは当日のみ now まで加算）
  staleOpenCount: number; // 過去日の退勤忘れ件数
};

/** 月内 shifts をキャスト別に集計する。todayKey は営業日キー（YYYY-MM-DD） */
export function summarizeTeamShifts(shifts: TeamShift[], todayKey: string, nowMs: number): CastAttendance[] {
  const byCast = new Map<string, TeamShift[]>();
  for (const s of shifts) {
    if (!s.castUid) continue;
    const arr = byCast.get(s.castUid) ?? [];
    arr.push(s);
    byCast.set(s.castUid, arr);
  }
  const out: CastAttendance[] = [];
  for (const [castUid, list] of byCast) {
    const days = new Set<string>();
    let monthMinutes = 0;
    let todayMinutes = 0;
    let today: CastAttendance['today'] = 'none';
    let todayStartMs: number | null = null;
    let staleOpenCount = 0;
    for (const s of list) {
      if (s.date) days.add(s.date);
      const isToday = s.date === todayKey;
      const end = s.endMs ?? (isToday ? nowMs : null); // 過去日の未退勤は時間計上しない（給与と同じ扱い）
      const min = s.startMs && end && end > s.startMs ? Math.floor((end - s.startMs) / 60000) : 0;
      monthMinutes += min;
      if (isToday) {
        todayMinutes += min;
        if (!s.endMs) { today = 'working'; todayStartMs = s.startMs; }
        else if (today !== 'working') today = 'done';
      }
      // 過去日で時間計上されない勤務は警告に載せる（給与 finalize-payroll と同基準）:
      //   未退勤(endMs 無し) だけでなく、end<=start の破損（日跨ぎを同暦日で締めた旧データ）も
      //   0 分で黙って落ちるので staleOpen としてカウントする。放置＝過少支給の温床。
      const corruptedEnd = s.startMs != null && s.endMs != null && s.endMs <= s.startMs;
      if (!isToday && (!s.endMs || corruptedEnd)) staleOpenCount += 1;
    }
    out.push({ castUid, today, todayStartMs, todayMinutes, monthDays: days.size, monthMinutes, staleOpenCount });
  }
  // 勤務中 → 本日出勤済 → その他、同状態内は月間分数の多い順
  const rank = { working: 0, done: 1, none: 2 } as const;
  out.sort((a, b) => rank[a.today] - rank[b.today] || b.monthMinutes - a.monthMinutes);
  return out;
}
