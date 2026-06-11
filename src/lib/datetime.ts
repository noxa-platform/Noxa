/**
 * 営業日キー（夜職基準）。深夜6時より前は前日扱い。
 * 売上の書き込み側(POS)と読み取り側(売上集計)で同一ロジックを使うため一本化（誤集計防止）。
 */
export function businessDayKey(d: Date = new Date()): string {
  const base = new Date(d);
  if (base.getHours() < 6) base.setDate(base.getDate() - 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

/** 営業日キーの年月（YYYY-MM）。月次集計用。 */
export function businessMonthKey(d: Date = new Date()): string {
  return businessDayKey(d).slice(0, 7);
}
